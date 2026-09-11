import type { Page } from '@playwright/test';
import { waitForStoryRender } from './waitForStoryRender.js';

/** Serializes Storybook globals into the `globals` query parameter, e.g. `theme:dark;locale:en`. */
function getGlobalsParameter(globals: Record<string, string>): string {
  return Object.entries(globals)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

/**
 * Navigates to a story and waits for it to render and for its assets to paint.
 *
 * Globals travel in the URL because a preview decorator that writes an attribute
 * from a global cannot be driven by Playwright's `colorScheme` alone.
 */
export async function goToStory(page: Page, storyId: string, globals: Record<string, string>): Promise<void> {
  const globalsParameter = getGlobalsParameter(globals);
  const suffix = globalsParameter ? `&globals=${globalsParameter}` : '';

  await waitForStoryRender(page, `/iframe.html?id=${storyId}&viewMode=story${suffix}`);
  await waitForResources(page);
}

/**
 * Waits for images, stylesheets, and scripts still in flight after the story
 * reports rendered, then for one animation frame so the browser has painted
 * them. Without this a late asset lands between render and capture, and the
 * screenshot differs run to run.
 */
async function waitForResources(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const window = globalThis as unknown as {
      document: {
        querySelectorAll: (selector: string) => ArrayLike<{
          complete?: boolean;
          addEventListener: (event: string, handler: () => void) => void;
        }>;
      };
      requestAnimationFrame: (callback: () => void) => void;
    };

    const elements = Array.from(window.document.querySelectorAll('img, link[rel="stylesheet"], script[src]'));

    const allLoaded = Promise.all(
      elements
        .filter((element) => element.complete === false)
        .map(
          (element) =>
            new Promise<void>((resolve) => {
              element.addEventListener('load', resolve);
              element.addEventListener('error', resolve);
            }),
        ),
    );

    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => {
        reject(new Error('Timed out waiting for resources to load'));
      }, 5000),
    );

    await Promise.race([allLoaded, timeout]);
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(resolve);
    });
  });
}
