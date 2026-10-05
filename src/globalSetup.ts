import { relative } from 'node:path';
import type { BrowserType } from '@playwright/test';
import color from 'picocolors';
import { deriveAffected } from './affected.js';
import { cleanUpBaselines } from './cleanUpBaselines.js';
import { createDebugLogger } from './debugLogger.js';
import type { Manifest } from './manifest.js';
import { deriveManifest, getStoryIndex, setManifest } from './manifest.js';
import { getRepositoryRoot, getResolvedOptions } from './paths.js';
import { setFontConfigOverride } from './setFontConfigOverride.js';
import type { ExtractedStoryOptions } from './storyOptions.js';
import { applyStoryOptions, extractStoryOptions } from './storyOptions.js';
import { waitForStoryRender } from './waitForStoryRender.js';
import { warmUpServer } from './warmUpServer.js';

/**
 * Runs once before the suite, in the runner process, ahead of test discovery.
 *
 * 1. Neutralizes host fontconfig differences Playwright's Chromium cannot parse.
 * 2. Fetches Storybook's story index.
 * 3. Narrows to the stories affected by the current diff, when a base ref is set.
 * 4. Removes baselines for stories that no longer exist.
 * 5. Warms Storybook on the first story, so the first test does not pay for the cold start.
 * 6. Reads each story's `screenshotOptions` parameter from that warm preview.
 * 7. Writes the manifest the test workers read at module load.
 *
 * Takes the runner's own `chromium` so the warm-up uses the browsers the tests
 * will use, rather than whichever Playwright installation this package resolves to.
 */
export async function globalSetup(browserType: BrowserType): Promise<void> {
  // Thrown rather than exiting, so Playwright reports the error and still shuts
  // down the Storybook server it started — an exit here would leave it running.
  const fontConfigFile = await setFontConfigOverride();

  const options = getResolvedOptions();
  const logDebug = createDebugLogger(options.debug);

  logDebug(`options ${JSON.stringify(options)}`);
  logDebug(fontConfigFile ? `fontconfig override at ${fontConfigFile}` : 'fontconfig override not needed');

  const projectNames = options.projects.map((project) => project.name);

  const index = await getStoryIndex(options.storybookUrl);
  const everyStory = deriveManifest(index, options.tags, projectNames);

  const { importPaths, buildOutputPackages, reason } = await deriveAffected({
    repositoryRoot: getRepositoryRoot(options.rootDir),
    projectRoot: options.rootDir,
    storyImportPaths: everyStory.allImportPaths,
    options: options.affected,
  });

  logDebug(`affected: ${importPaths ? 'narrowed' : 'capturing every story'}, because ${reason}`);

  reportBuildOutputPackages(buildOutputPackages, options.rootDir);

  const manifest = deriveManifest(index, options.tags, projectNames, importPaths);

  cleanUpBaselines(options.rootDir, everyStory.stories);

  const firstStory = manifest.stories[0];

  if (!firstStory) {
    writeManifest(manifest, options.affected.baseRef);

    return;
  }

  logDebug(`warming up on ${firstStory.id}`);

  const startedAt = performance.now();

  let extracted: Record<string, ExtractedStoryOptions> | undefined;

  try {
    await warmUpServer(browserType, 'Storybook', async (page) => {
      await waitForStoryRender(page, `${options.storybookUrl}/iframe.html?id=${firstStory.id}&viewMode=story`, {
        debug: options.debug,
        timeout: options.warmUpTimeout,
      });

      extracted = await extractStoryOptions(
        page,
        manifest.stories.map((story) => story.id),
      );
    });
  } catch (error) {
    throw new Error(
      `Warming up Storybook on "${firstStory.key}" (${firstStory.id}) failed: `
        + `${error instanceof Error ? error.message : String(error)}\n`
        + 'This is the first story the run captures. Set `debug: true` to see its page and channel events.',
      { cause: error },
    );
  }

  logDebug(`warm-up took ${Math.round(performance.now() - startedAt)}ms`);

  if (!extracted) {
    console.warn(
      color.yellow(
        'The Storybook preview exposes no story store, so `screenshotOptions` parameters are ignored this run.',
      ),
    );
  }

  writeManifest(extracted ? applyStoryOptions(manifest, extracted, logDebug) : manifest, options.affected.baseRef);
}

/**
 * Writes the manifest and says so.
 *
 * No count here: `--project`, `--grep`, and the rest are applied after global
 * setup, so any number this could print may overstate the run. The reporter
 * prints the real one once Playwright has filtered.
 */
function writeManifest(manifest: Manifest, baseRef: string | undefined): void {
  setManifest(manifest);

  console.log(
    manifest.capturedCount < manifest.totalCount
      ? `Manifest written, narrowed to stories affected since ${baseRef}.`
      : 'Manifest written.',
  );
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
