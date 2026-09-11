import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import type { AffectedOptions } from './options.js';

interface CruiseModule {
  source: string;
  dependencies: Array<{ resolved: string }>;
}

const DIFF_LINE = /^[+-]/;
const DIFF_HEADER = /^[+-]{3}/;
const LEADING_DOT_SLASH = /^\.\//;
const TRAILING_SLASH = /\/+$/;

const LOCKFILES = [
  { file: 'yarn.lock', getMatcher: (name: string) => `${name}@npm:` },
  { file: 'pnpm-lock.yaml', getMatcher: (name: string) => `/${name}@` },
  { file: 'package-lock.json', getMatcher: (name: string) => `node_modules/${name}"` },
];

export interface AffectedInput {
  repositoryRoot: string;
  /** Directory the Storybook `importPath` values are relative to. */
  projectRoot: string;
  /** Every screenshot story's `importPath`, used as the graph's entry points. */
  storyImportPaths: string[];
  options: AffectedOptions;
}

export interface AffectedResult {
  /** Story import paths to capture, or `undefined` to capture all of them. */
  importPaths: Set<string> | undefined;
  /** Workspace packages the graph reached through a build output rather than source. */
  buildOutputPackages: string[];
}

/**
 * Returns the stories transitively affected by everything changed since
 * `baseRef`, by cruising the story files themselves as entry points.
 *
 * Using the stories as entries — rather than scanning a source directory —
 * means the graph is exactly what the stories reach. Nothing else is walked,
 * and `node_modules` falls out without an exclusion rule.
 *
 * Returns `undefined` for the import paths, meaning "capture everything", when
 * no base ref is set, when nothing changed, when a declared full-rerun path
 * changed, or when a dependency the stories actually reach changed version.
 */
export async function deriveAffected({
  repositoryRoot,
  projectRoot,
  storyImportPaths,
  options,
}: AffectedInput): Promise<AffectedResult> {
  const baseRef = options.baseRef;

  if (!baseRef) {
    return { importPaths: undefined, buildOutputPackages: [] };
  }

  const changedOutput = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    cwd: repositoryRoot,
    encoding: 'utf-8',
  }).trim();

  if (!changedOutput) {
    return { importPaths: undefined, buildOutputPackages: [] };
  }

  const changedFiles = changedOutput.split('\n').filter(Boolean);

  // Checked before the cruise, which is the expensive half: if everything is
  // being captured anyway, there is no graph worth building.
  if (hasFullRerunPathChange(changedFiles, options.fullRerunPaths)) {
    return { importPaths: undefined, buildOutputPackages: [] };
  }

  const entryPoints = storyImportPaths.map((importPath) =>
    relative(repositoryRoot, resolve(projectRoot, importPath.replace(LEADING_DOT_SLASH, ''))),
  );

  const { cruise } = await import('dependency-cruiser');
  const result = await cruise(entryPoints, {
    baseDir: repositoryRoot,
    outputType: 'json',
    ...options.cruiseOptions,
  });

  const { modules } = JSON.parse(result.output as string) as { modules: CruiseModule[] };

  const reverseGraph: Record<string, string[]> = {};
  const externalPackages = new Set<string>();
  const buildOutputPackages = new Set<string>();

  for (const cruiseModule of modules) {
    if (cruiseModule.source.startsWith('node_modules/')) {
      continue;
    }

    registerBuildOutput(cruiseModule.source, repositoryRoot, buildOutputPackages);

    for (const dependency of cruiseModule.dependencies) {
      if (dependency.resolved.startsWith('node_modules/')) {
        externalPackages.add(getPackageName(dependency.resolved));
        continue;
      }

      reverseGraph[dependency.resolved] ??= [];
      reverseGraph[dependency.resolved]?.push(cruiseModule.source);
    }
  }

  if (hasVisualDependencyChange(changedFiles, externalPackages, repositoryRoot, baseRef, options)) {
    return { importPaths: undefined, buildOutputPackages: [...buildOutputPackages] };
  }

  const storyFiles = new Set(entryPoints);
  const importPaths = findAffectedStories(changedFiles, reverseGraph, storyFiles).map(
    (storyFile) => `./${relative(projectRoot, resolve(repositoryRoot, storyFile))}`,
  );

  return {
    importPaths: new Set(importPaths),
    buildOutputPackages: [...buildOutputPackages],
  };
}

/**
 * Walks the reverse graph upward from each changed file and collects the story
 * files reached. A changed file that is itself a story short-circuits, so a
 * newly added story is captured even though the graph predates it.
 * @internal Exported for tests.
 */
export function findAffectedStories(
  changedFiles: string[],
  reverseGraph: Record<string, string[]>,
  storyFiles: Set<string>,
): string[] {
  const stories = new Set<string>();
  const visited = new Set<string>();

  function traverseUpward(key: string): void {
    if (visited.has(key)) {
      return;
    }

    visited.add(key);

    if (storyFiles.has(key)) {
      stories.add(key);

      return;
    }

    for (const importer of reverseGraph[key] ?? []) {
      traverseUpward(importer);
    }
  }

  for (const changedFile of changedFiles) {
    traverseUpward(changedFile);
  }

  return [...stories];
}

/**
 * Whether the diff touched a path declared as capturing everything.
 *
 * An entry matches the file it names, and — treated as a directory — everything
 * beneath it. The separator is appended rather than assumed, so `src/styles`
 * covers `src/styles/global.css` without also covering `src/styles-legacy.css`.
 * @internal Exported for tests.
 */
export function hasFullRerunPathChange(changedFiles: string[], fullRerunPaths: string[] = []): boolean {
  return changedFiles.some((file) =>
    fullRerunPaths.some((fullRerunPath) => {
      const normalized = fullRerunPath.replace(TRAILING_SLASH, '');

      return file === normalized || file.startsWith(`${normalized}/`);
    }),
  );
}

/** Extracts `name` or `@scope/name` from a `node_modules/...` path. */
function getPackageName(resolvedPath: string): string {
  const parts = resolvedPath.slice('node_modules/'.length).split('/');
  const first = parts[0] ?? '';

  return first.startsWith('@') ? `${first}/${parts[1] ?? ''}` : first;
}

/**
 * Records any workspace package the graph reached through a build directory.
 * That happens when the package's export map has no condition pointing at its
 * source, and it means edits to that package's source are invisible here — the
 * story silently will not re-run.
 */
function registerBuildOutput(source: string, repositoryRoot: string, buildOutputPackages: Set<string>): void {
  const match = /^(.*)\/(?:dist|build|lib|out-tsc)\//.exec(source);

  if (match?.[1]) {
    buildOutputPackages.add(resolve(repositoryRoot, match[1]));
  }
}

/**
 * Returns true when the lockfile changed for a package the stories actually
 * reach — a version bump that could move a pixel, so every story is captured.
 */
function hasVisualDependencyChange(
  changedFiles: string[],
  externalPackages: Set<string>,
  repositoryRoot: string,
  baseRef: string,
  options: AffectedOptions,
): boolean {
  const lockfile = LOCKFILES.find(({ file }) =>
    options.lockfile ? file === options.lockfile : changedFiles.includes(file),
  );

  if (!lockfile || !changedFiles.includes(lockfile.file) || externalPackages.size === 0) {
    return false;
  }

  const lockDiff = execFileSync('git', ['diff', `${baseRef}...HEAD`, '--', lockfile.file], {
    cwd: repositoryRoot,
    encoding: 'utf-8',
  });
  const changedLines = lockDiff.split('\n').filter((line) => DIFF_LINE.test(line) && !DIFF_HEADER.test(line));

  return [...externalPackages].some((packageName) =>
    changedLines.some((line) => line.includes(lockfile.getMatcher(packageName))),
  );
}
