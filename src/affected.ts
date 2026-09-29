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
  /** Why the run captures what it does, e.g. which changed path forced every story. */
  reason: string;
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
    return { importPaths: undefined, buildOutputPackages: [], reason: 'no base ref is set' };
  }

  const changedOutput = getGitDiff(['--name-only', `${baseRef}...HEAD`], repositoryRoot, baseRef).trim();

  if (!changedOutput) {
    return { importPaths: undefined, buildOutputPackages: [], reason: `nothing changed since ${baseRef}` };
  }

  const changedFiles = changedOutput.split('\n').filter(Boolean);

  // Checked before the cruise, which is the expensive half: if everything is
  // being captured anyway, there is no graph worth building.
  const fullRerunFile = getFullRerunPathChange(changedFiles, options.fullRerunPaths);

  if (fullRerunFile) {
    return {
      importPaths: undefined,
      buildOutputPackages: [],
      reason: `${fullRerunFile} changed, and it is under a full-rerun path`,
    };
  }

  const entryPoints = storyImportPaths.map((importPath) =>
    relative(repositoryRoot, resolve(projectRoot, importPath.replace(LEADING_DOT_SLASH, ''))),
  );

  const modules = await getCruisedModules(entryPoints, repositoryRoot, options.cruiseOptions);

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

  const changedPackage = getVisualDependencyChange(changedFiles, externalPackages, repositoryRoot, baseRef, options);

  if (changedPackage) {
    return {
      importPaths: undefined,
      buildOutputPackages: [...buildOutputPackages],
      reason: `the lockfile changed ${changedPackage}, which the stories import`,
    };
  }

  const storyFiles = new Set(entryPoints);
  const importPaths = findAffectedStories(changedFiles, reverseGraph, storyFiles).map(
    (storyFile) => `./${relative(projectRoot, resolve(repositoryRoot, storyFile))}`,
  );

  return {
    importPaths: new Set(importPaths),
    buildOutputPackages: [...buildOutputPackages],
    reason: `${changedFiles.length} changed file(s) since ${baseRef} reach ${importPaths.length} story file(s)`,
  };
}

/**
 * Runs `git diff` against the base ref, turning git's failure into one that says
 * what to fix. A shallow clone — the default on most CI checkouts — has no
 * merge base to diff against, and git's own message does not say so.
 */
function getGitDiff(args: string[], repositoryRoot: string, baseRef: string): string {
  try {
    return execFileSync('git', ['diff', ...args], {
      cwd: repositoryRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim() ?? '';

    throw new Error(
      [
        `Could not diff against the base ref "${baseRef}" to find affected stories.`,
        ...(stderr ? [`git: ${stderr}`] : []),
        'The ref and its merge base with HEAD must be in local history. On CI, fetch full history',
        '(for actions/checkout, `fetch-depth: 0`), or unset `affected.baseRef` to capture every story.',
      ].join('\n'),
      { cause: error },
    );
  }
}

/** Cruises the story files, naming the step when dependency-cruiser fails. */
async function getCruisedModules(
  entryPoints: string[],
  repositoryRoot: string,
  cruiseOptions: Record<string, unknown> | undefined,
): Promise<CruiseModule[]> {
  try {
    const { cruise } = await import('dependency-cruiser');
    const result = await cruise(entryPoints, {
      baseDir: repositoryRoot,
      outputType: 'json',
      ...cruiseOptions,
    });

    return (JSON.parse(result.output as string) as { modules: CruiseModule[] }).modules;
  } catch (error) {
    throw new Error(
      `Affected-story detection failed while dependency-cruiser walked the stories' imports: ${
        error instanceof Error ? error.message : String(error)
      }\nCheck \`affected.cruiseOptions\`, or unset \`affected.baseRef\` to capture every story.`,
      { cause: error },
    );
  }
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
  return getFullRerunPathChange(changedFiles, fullRerunPaths) !== undefined;
}

/**
 * The first changed file under a full-rerun path, if any.
 * @internal Exported for tests.
 */
export function getFullRerunPathChange(changedFiles: string[], fullRerunPaths: string[] = []): string | undefined {
  return changedFiles.find((file) =>
    fullRerunPaths.some((fullRerunPath) => {
      const normalized = fullRerunPath.replace(TRAILING_SLASH, '');

      return file === normalized || file.startsWith(`${normalized}/`);
    }),
  );
}

/**
 * Extracts `name` or `@scope/name` from a `node_modules/...` path.
 * @internal Exported for tests.
 */
export function getPackageName(resolvedPath: string): string {
  const parts = resolvedPath.slice('node_modules/'.length).split('/');
  const first = parts[0] ?? '';

  return first.startsWith('@') ? `${first}/${parts[1] ?? ''}` : first;
}

/**
 * Records any workspace package the graph reached through a build directory.
 * That happens when the package's export map has no condition pointing at its
 * source, and it means edits to that package's source are invisible here — the
 * story silently will not re-run.
 * @internal Exported for tests.
 */
export function registerBuildOutput(source: string, repositoryRoot: string, buildOutputPackages: Set<string>): void {
  const match = /^(.*)\/(?:dist|build|lib|out-tsc)\//.exec(source);

  if (match?.[1]) {
    buildOutputPackages.add(resolve(repositoryRoot, match[1]));
  }
}

/**
 * Returns the first package the stories reach whose lockfile entry changed — a
 * version bump that could move a pixel, so every story is captured.
 */
function getVisualDependencyChange(
  changedFiles: string[],
  externalPackages: Set<string>,
  repositoryRoot: string,
  baseRef: string,
  options: AffectedOptions,
): string | undefined {
  const lockfile = LOCKFILES.find(({ file }) =>
    options.lockfile ? file === options.lockfile : changedFiles.includes(file),
  );

  if (!lockfile || !changedFiles.includes(lockfile.file) || externalPackages.size === 0) {
    return undefined;
  }

  const lockDiff = getGitDiff([`${baseRef}...HEAD`, '--', lockfile.file], repositoryRoot, baseRef);

  return getChangedPackage(lockDiff, externalPackages, lockfile.file);
}

/**
 * Finds the first of `packageNames` whose entry a lockfile diff adds or removes.
 * @internal Exported for tests.
 */
export function getChangedPackage(
  lockDiff: string,
  packageNames: Iterable<string>,
  lockfileName: string,
): string | undefined {
  const lockfile = LOCKFILES.find(({ file }) => file === lockfileName);

  if (!lockfile) {
    return undefined;
  }

  const changedLines = lockDiff.split('\n').filter((line) => DIFF_LINE.test(line) && !DIFF_HEADER.test(line));

  return [...packageNames].find((packageName) =>
    changedLines.some((line) => line.includes(lockfile.getMatcher(packageName))),
  );
}
