import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StoryRecord } from './manifest.js';
import { deriveBaselineDirectory, deriveBaselineSegments } from './storyPath.js';

const SCREENSHOTS_DIRECTORY = '__screenshots__';
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'out-tsc',
  'coverage',
  '.git',
  '.nx',
  'test-output',
]);

/**
 * Finds every `__screenshots__` directory under `rootDirectory`, as paths
 * relative to it. Walking the tree rather than reading the manifest is what
 * catches a directory whose stories were deleted along with their source file.
 * @internal Exported for tests.
 */
export function getBaselineDirectories(rootDirectory: string, prefix = ''): string[] {
  const absolute = prefix ? resolve(rootDirectory, prefix) : rootDirectory;
  const directories: string[] = [];

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.name === SCREENSHOTS_DIRECTORY) {
      directories.push(relativePath);
      continue;
    }

    directories.push(...getBaselineDirectories(rootDirectory, relativePath));
  }

  return directories;
}

/**
 * Maps each `__screenshots__` directory to the baseline file names that should
 * exist inside each of its project subdirectories.
 * @internal Exported for tests.
 */
export function getExpectedBaselines(
  stories: StoryRecord[],
  projectNames: string[],
): Map<string, Set<string>> {
  const expected = new Map<string, Set<string>>();

  for (const story of stories) {
    const directory = deriveBaselineDirectory(story.importPath);

    for (const projectName of projectNames) {
      const segments = deriveBaselineSegments(story.importPath, story.key, projectName);
      const fileName = segments[segments.length - 1];

      if (!fileName) {
        continue;
      }

      const key = `${directory}/${projectName}`;
      const names = expected.get(key) ?? new Set<string>();

      names.add(fileName);
      expected.set(key, names);
    }
  }

  return expected;
}

/**
 * Removes baselines for stories that no longer carry the screenshot tag, then
 * prunes the directories left empty.
 *
 * `stories` must be the complete, unfiltered set. Handing it a set narrowed by
 * affected-story detection would delete the baselines of every story the run
 * skipped, silently rebaselining them on the next full run.
 */
export function cleanUpBaselines(
  rootDirectory: string,
  stories: StoryRecord[],
  projectNames: string[],
): void {
  if (!existsSync(rootDirectory)) {
    return;
  }

  const expected = getExpectedBaselines(stories, projectNames);

  for (const directory of getBaselineDirectories(rootDirectory)) {
    const absoluteDirectory = resolve(rootDirectory, directory);

    for (const projectName of readdirSync(absoluteDirectory)) {
      const projectDirectory = resolve(absoluteDirectory, projectName);

      if (!statSync(projectDirectory).isDirectory()) {
        continue;
      }

      const names = expected.get(`${directory}/${projectName}`) ?? new Set<string>();

      for (const file of readdirSync(projectDirectory)) {
        if (!names.has(file)) {
          rmSync(resolve(projectDirectory, file));
        }
      }

      if (readdirSync(projectDirectory).length === 0) {
        rmSync(projectDirectory, { recursive: true });
      }
    }

    if (readdirSync(absoluteDirectory).length === 0) {
      rmSync(absoluteDirectory, { recursive: true });
    }
  }
}
