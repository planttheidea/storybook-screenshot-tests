import { goToStory } from './goToStory.js';
import type { StoryRecord } from './manifest.js';
import { getManifest } from './manifest.js';
import { getResolvedOptions } from './paths.js';
import type { BaseExpect, BaseTest } from './screenshotTest.js';
import { createScreenshotTest } from './screenshotTest.js';
import { deriveBaselineSegments, getComponentName, getStoryKeyParts } from './storyPath.js';

export interface RegisterScreenshotTestsInput {
  /** The runner's own `test`, so registrations land in the registry it collects from. */
  test: BaseTest;
  /** The runner's own `expect`, so `toHaveScreenshot` resolves against the active config. */
  expect: BaseExpect;
}

/** Groups stories by domain, then by component, preserving discovery order. */
function getGroupedStories(stories: StoryRecord[]): Map<string, Map<string, StoryRecord[]>> {
  const byDomain = new Map<string, Map<string, StoryRecord[]>>();

  for (const story of stories) {
    const { title } = getStoryKeyParts(story.key);
    const byComponent = byDomain.get(story.domain) ?? new Map<string, StoryRecord[]>();
    const componentName = getComponentName(title);

    byComponent.set(componentName, [...(byComponent.get(componentName) ?? []), story]);
    byDomain.set(story.domain, byComponent);
  }

  return byDomain;
}

/**
 * Builds the test tree from the manifest written by global setup.
 *
 * Called at module load from the generated stub, because Playwright collects
 * tests when it loads a file — there is no fixture or `testInfo` yet, which is
 * why the manifest travels through disk rather than through the config object.
 */
export function registerScreenshotTests({ test: baseTest, expect }: RegisterScreenshotTestsInput): void {
  const options = getResolvedOptions();
  const { stories } = getManifest();
  const test = createScreenshotTest(baseTest);

  if (options.fixedTime) {
    const fixedTime = new Date(options.fixedTime);

    test.beforeEach(async ({ context }) => {
      await context.clock.setFixedTime(fixedTime);
    });
  }

  for (const [domain, byComponent] of getGroupedStories(stories)) {
    test.describe(domain, () => {
      for (const [componentName, componentStories] of byComponent) {
        test.describe(componentName, () => {
          for (const story of componentStories) {
            const { name } = getStoryKeyParts(story.key);

            test(name, async ({ page, storybookGlobals }, testInfo) => {
              test.fixme(story.failing, `Known failure — tagged ${options.tags.failing}`);

              await goToStory(page, story.id, storybookGlobals);
              await expect(page).toHaveScreenshot(
                deriveBaselineSegments(story.importPath, story.key, testInfo.project.name),
              );
            });
          }
        });
      }
    });
  }
}
