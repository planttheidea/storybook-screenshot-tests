import type { BrowserType } from '@playwright/test';
import { relative } from 'node:path';
import color from 'picocolors';
import { deriveAffected } from './affected.js';
import { cleanUpBaselines } from './cleanUpBaselines.js';
import { deriveManifest, getStoryIndex, setManifest } from './manifest.js';
import { getRepositoryRoot, getResolvedOptions } from './paths.js';
import { setFontConfigOverride } from './setFontConfigOverride.js';
import { waitForStoryRender } from './waitForStoryRender.js';
import { warmUpServer } from './warmUpServer.js';

/**
 * Runs once before the suite, in the runner process, ahead of test discovery.
 *
 * 1. Neutralizes host fontconfig differences Playwright's Chromium cannot parse.
 * 2. Fetches Storybook's story index.
 * 3. Narrows to the stories affected by the current diff, when a base ref is set.
 * 4. Writes the manifest the test workers read at module load.
 * 5. Removes baselines for stories that no longer exist.
 * 6. Warms Storybook on the first story, so the first test does not pay for the cold start.
 *
 * Takes the runner's own `chromium` so the warm-up uses the browsers the tests
 * will use, rather than whichever Playwright installation this package resolves to.
 */
export async function globalSetup(browserType: BrowserType): Promise<void> {
  try {
    await setFontConfigOverride();

    const options = getResolvedOptions();

    const index = await getStoryIndex(options.storybookUrl);
    const everyStory = deriveManifest(index, options.tags);

    const { importPaths, buildOutputPackages } = await deriveAffected({
      repositoryRoot: getRepositoryRoot(options.rootDir),
      projectRoot: options.rootDir,
      storyImportPaths: everyStory.allImportPaths,
      options: options.affected,
    });

    reportBuildOutputPackages(buildOutputPackages, options.rootDir);

    const manifest = deriveManifest(index, options.tags, importPaths);

    setManifest(manifest);
    cleanUpBaselines(
      options.rootDir,
      everyStory.stories,
      options.projects.map((project) => project.name),
    );

    const coverage =
      manifest.capturedCount === manifest.totalCount
        ? `all ${manifest.totalCount} stories`
        : `${manifest.capturedCount} of ${manifest.totalCount} stories`;

    console.log(`Manifest written, capturing ${coverage}.`);

    const firstStory = manifest.stories[0];

    if (firstStory) {
      await warmUpServer(browserType, 'Storybook', (page) =>
        waitForStoryRender(
          page,
          `${options.storybookUrl}/iframe.html?id=${firstStory.id}&viewMode=story`,
          60_000,
        ),
      );
    }
  } catch (error) {
    console.error(error);

    process.exit(1);
  }
}

/**
 * Warns about workspace packages the dependency graph reached through a build
 * directory instead of their source.
 *
 * Those packages are invisible to affected-story detection: editing their source
 * changes no file the graph knows about, so the stories that depend on them do
 * not re-run and the stale baseline is never reported. Adding a condition to the
 * package's export map that points at its source is the fix.
 */
function reportBuildOutputPackages(packages: string[], rootDirectory: string): void {
  if (packages.length === 0) {
    return;
  }

  const names = packages.map((absolute) => relative(rootDirectory, absolute)).sort();

  console.warn(
    color.yellow(
      [
        '',
        `Resolved ${names.length} workspace package(s) to build output rather than source:`,
        ...names.map((name) => `  ${name}`),
        'Edits to their source will not re-run any story. Add an export condition',
        'pointing at source, and list it in `affected.cruiseOptions`.',
        '',
      ].join('\n'),
    ),
  );
}

export default globalSetup;
