import type { Page } from '@playwright/test';
import type { WaitForStoryRenderConfig } from './waitForStoryRender.js';
import { waitForStoryRender } from './waitForStoryRender.js';

/**
 * Serializes Storybook globals into the `globals` query parameter, e.g. `theme:dark;locale:en`.
 * @internal Exported for tests.
 */
export function getGlobalsParameter(globals: Record<string, string>): string {
  return Object.entries(globals)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

/**
 * Below Playwright's 30-second default test timeout, so a story that never
 * renders fails with the render phase it reached rather than the generic
 * test timeout.
 */
const RENDER_TIMEOUT = 20_000;

/**
 * Navigates to a story and waits for it to render and for its assets to paint.
 *
 * Globals travel in the URL because a preview decorator that writes an attribute
 * from a global cannot be driven by Playwright's `colorScheme` alone.
 */
export async function goToStory(
  page: Page,
  storyId: string,
  globals: Record<string, string>,
  config: WaitForStoryRenderConfig = {},
): Promise<void> {
  const globalsParameter = getGlobalsParameter(globals);
  const suffix = globalsParameter ? `&globals=${globalsParameter}` : '';

  const startedAt = performance.now();

  await waitForStoryRender(page, `/iframe.html?id=${storyId}&viewMode=story${suffix}`, {
    timeout: RENDER_TIMEOUT,
    ...config,
  });

  const renderedAt = performance.now();

  await waitForResources(page);

  if (config.debug) {
    const renderDuration = Math.round(renderedAt - startedAt);
    const resourcesDuration = Math.round(performance.now() - renderedAt);

    console.log(`[timing] ${storyId} rendered in ${renderDuration}ms, resources settled in ${resourcesDuration}ms`);
  }
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
          currentSrc?: string;
          href?: string;
          src?: string;
          addEventListener: (event: string, handler: () => void) => void;
        }>;
      };
      requestAnimationFrame: (callback: () => void) => void;
    };

    const elements = Array.from(window.document.querySelectorAll('img, link[rel="stylesheet"], script[src]'));
    const pending = new Set<string>();

    const allLoaded = Promise.all(
      elements
        .filter((element) => element.complete === false)
        .map((element) => {
          // Empty strings are skipped too, as an element without that attribute reports one.
          const source = [element.currentSrc, element.src, element.href].find(Boolean) ?? '<inline>';

          pending.add(source);

          return new Promise<void>((resolve) => {
            const settle = () => {
              pending.delete(source);
              resolve();
            };

            element.addEventListener('load', settle);
            element.addEventListener('error', settle);
          });
        }),
    );

    // Names what is still loading, so a slow or hanging asset can be found
    // without a trace.
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`Timed out after 5000ms waiting for resources to load: ${[...pending].join(', ')}`));
      }, 5000),
    );

    await Promise.race([allLoaded, timeout]);
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(resolve);
    });
  });
}
