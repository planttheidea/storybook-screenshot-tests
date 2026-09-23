import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TagOptions } from './options.js';
import { getGeneratedDirectory } from './paths.js';

interface StoryIndexEntry {
  id: string;
  title: string;
  name: string;
  type: string;
  tags: string[];
  /** Path of the story file relative to the Storybook project root, e.g. `./src/Foo/Foo.stories.tsx`. */
  importPath?: string;
}

interface StoryIndex {
  v: number;
  entries: Record<string, StoryIndexEntry>;
}

/** One story, reduced to what the test tree and the baseline path need. */
export interface StoryRecord {
  /** `"Components/AccountSignIn/ValidationError"` — title path plus space-stripped story name. */
  key: string;
  id: string;
  importPath: string;
  domain: string;
  failing: boolean;
  /** Names of the projects this story is captured in — every project, unless its tags name specific ones. */
  projects: string[];
}

export interface Manifest {
  stories: StoryRecord[];
  /** Story import paths present in Storybook, before any affected filtering. */
  allImportPaths: string[];
  /** Screenshots this run captures — one per story per project it is captured in. */
  capturedCount: number;
  /** Screenshots across every tagged story, before any affected filtering. */
  totalCount: number;
}

const MANIFEST_FILE = 'manifest.json';

/** Fetches Storybook's story index. Throws with the status rather than a bare parse error. */
export async function getStoryIndex(storybookUrl: string): Promise<StoryIndex> {
  const response = await fetch(`${storybookUrl}/index.json`);

  if (!response.ok) {
    throw new Error(`Failed to fetch Storybook index: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as StoryIndex;
}

/**
 * Returns the projects a story is captured in, or `undefined` when it is not
 * captured at all.
 *
 * The bare tag selects every project. `<tag>:<project>` narrows the story to
 * that project, and several of them to exactly those — any project tag
 * replaces the bare one rather than adding to it. That matters because
 * Storybook flattens preview, meta, and story tags into one list with no record
 * of where each came from, so a story narrowing a meta's bare tag looks
 * identical to one carrying both.
 *
 * The disabled tag opts a story out entirely, which is how a single story
 * leaves a meta-wide tag. A failing tag that is itself a `<tag>:*` variant
 * selects the story without narrowing it. Any other `<tag>:*` suffix is almost
 * certainly a misspelled project name, and throws rather than silently
 * capturing too much or nothing at all.
 * @internal Exported for tests.
 */
export function getStoryProjects(
  entry: Pick<StoryIndexEntry, 'title' | 'name' | 'tags'>,
  tags: TagOptions,
  projectNames: string[],
): string[] | undefined {
  if (entry.tags.includes(tags.disabled)) {
    return undefined;
  }

  const prefix = `${tags.screenshot}:`;
  const selected = new Set<string>();

  let isTagged = false;

  for (const tag of entry.tags) {
    if (tag === tags.screenshot) {
      isTagged = true;
    } else if (tag.startsWith(prefix)) {
      isTagged = true;

      if (tag === tags.failing) {
        continue;
      }

      const projectName = tag.slice(prefix.length);

      if (!projectNames.includes(projectName)) {
        throw new Error(
          `Story "${entry.title}/${entry.name}" is tagged "${tag}", but there is no project named "${projectName}". `
            + `Known projects: ${projectNames.join(', ')}.`,
        );
      }

      selected.add(projectName);
    }
  }

  if (!isTagged) {
    return undefined;
  }

  return selected.size === 0 ? projectNames : projectNames.filter((projectName) => selected.has(projectName));
}

/**
 * Reduces the Storybook index to the screenshot-tagged stories, optionally
 * narrowed to those whose source file is in `allowedImportPaths`.
 *
 * Counts are in screenshots rather than stories: a story captured in four
 * projects is four screenshots, and that is the number that decides how long
 * the run takes.
 *
 * Entries without an `importPath` throw: the baseline location is derived from
 * that field, so a story without one has nowhere to write.
 */
export function deriveManifest(
  index: StoryIndex,
  tags: TagOptions,
  projectNames: string[],
  allowedImportPaths?: Set<string>,
): Manifest {
  const stories: StoryRecord[] = [];
  const allImportPaths = new Set<string>();

  let capturedCount = 0;
  let totalCount = 0;

  for (const entry of Object.values(index.entries)) {
    if (entry.type !== 'story') {
      continue;
    }

    const projects = getStoryProjects(entry, tags, projectNames);

    if (!projects) {
      continue;
    }

    if (!entry.importPath) {
      throw new Error(
        `Story "${entry.title}/${entry.name}" has no importPath, so its baseline location cannot be derived.`,
      );
    }

    totalCount += projects.length;
    allImportPaths.add(entry.importPath);

    if (allowedImportPaths && !allowedImportPaths.has(entry.importPath)) {
      continue;
    }

    const domainTag = entry.tags.find((tag) => tag.startsWith(tags.domainPrefix));

    capturedCount += projects.length;
    stories.push({
      key: `${entry.title}/${entry.name.replaceAll(' ', '')}`,
      id: entry.id,
      importPath: entry.importPath,
      domain: domainTag ? domainTag.slice(tags.domainPrefix.length) : 'uncategorized',
      failing: entry.tags.includes(tags.failing),
      projects,
    });
  }

  if (allImportPaths.size === 0) {
    throw new Error(
      `No stories tagged "${tags.screenshot}" were found. Tag the stories to capture, then refresh the Storybook index.`,
    );
  }

  return {
    stories,
    allImportPaths: [...allImportPaths],
    capturedCount,
    totalCount,
  };
}

/** Writes the manifest for the test workers, which read it synchronously at module load. */
export function setManifest(manifest: Manifest): void {
  const directory = getGeneratedDirectory();

  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

const EMPTY_MANIFEST: Manifest = {
  stories: [],
  allImportPaths: [],
  capturedCount: 0,
  totalCount: 0,
};

let currentManifest: Manifest | undefined;

/**
 * Reads the manifest written by global setup, caching it for the life of the process.
 *
 * Returns an empty manifest when the file is absent. `--list`, UI mode, and the
 * editor extensions load test files without running global setup, and an empty
 * tree is a better answer there than a crash on a missing file.
 */
export function getManifest(): Manifest {
  if (!currentManifest) {
    try {
      currentManifest = JSON.parse(readFileSync(resolve(getGeneratedDirectory(), MANIFEST_FILE), 'utf-8')) as Manifest;
    } catch {
      currentManifest = EMPTY_MANIFEST;
    }
  }

  return currentManifest;
}

/** Drops the in-process cache. @internal Exported for tests. */
export function clearManifestCache(): void {
  currentManifest = undefined;
}
