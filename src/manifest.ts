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
}

export interface Manifest {
  stories: StoryRecord[];
  /** Story import paths present in Storybook, before any affected filtering. */
  allImportPaths: string[];
  capturedCount: number;
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

function isScreenshotTag(tag: string, screenshotTag: string): boolean {
  return tag === screenshotTag || tag.startsWith(`${screenshotTag}:`);
}

/**
 * Reduces the Storybook index to the screenshot-tagged stories, optionally
 * narrowed to those whose source file is in `allowedImportPaths`.
 *
 * Entries without an `importPath` are skipped: the baseline location is derived
 * from that field, so a story without one has nowhere to write.
 */
export function deriveManifest(index: StoryIndex, tags: TagOptions, allowedImportPaths?: Set<string>): Manifest {
  const stories: StoryRecord[] = [];
  const allImportPaths = new Set<string>();

  let totalCount = 0;

  for (const entry of Object.values(index.entries)) {
    if (entry.type !== 'story' || !entry.tags.some((tag) => isScreenshotTag(tag, tags.screenshot))) {
      continue;
    }

    if (!entry.importPath) {
      throw new Error(
        `Story "${entry.title}/${entry.name}" has no importPath, so its baseline location cannot be derived.`,
      );
    }

    totalCount++;
    allImportPaths.add(entry.importPath);

    if (allowedImportPaths && !allowedImportPaths.has(entry.importPath)) {
      continue;
    }

    const domainTag = entry.tags.find((tag) => tag.startsWith(tags.domainPrefix));

    stories.push({
      key: `${entry.title}/${entry.name.replaceAll(' ', '')}`,
      id: entry.id,
      importPath: entry.importPath,
      domain: domainTag ? domainTag.slice(tags.domainPrefix.length) : 'uncategorized',
      failing: entry.tags.includes(tags.failing),
    });
  }

  if (totalCount === 0) {
    throw new Error(
      `No stories tagged "${tags.screenshot}" were found. Tag the stories to capture, then refresh the Storybook index.`,
    );
  }

  return {
    stories,
    allImportPaths: [...allImportPaths],
    capturedCount: stories.length,
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
