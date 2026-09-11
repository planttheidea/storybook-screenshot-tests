import type { Page } from '@playwright/test';

interface StoryState {
  error: string | undefined;
}

/**
 * Navigates to a Storybook story iframe and waits for it to finish rendering,
 * including any play function. Traps the addons channel on assignment so the
 * listener attaches before any story can render, rather than polling.
 *
 * Throws with Storybook's own error message when the story or its play function
 * fails, instead of hanging until the timeout.
 */
export async function waitForStoryRender(page: Page, url: string, timeout = 30_000): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
      configurable: true,
      set(channel: { once: (event: string, callback: (payload?: unknown) => void) => void }) {
        Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
          configurable: true,
          writable: true,
          value: channel,
        });

        const globals = globalThis as Record<string, unknown>;

        channel.once('storyRendered', () => {
          globals.__storyRendered = true;
        });

        const onError = (payload: unknown) => {
          globals.__storyError = payload instanceof Error ? payload.message : String(payload);
        };

        channel.once('storyThrewException', onError);
        channel.once('playFunctionThrewException', onError);
        channel.once('storyErrored', onError);
      },
    });
  });

  await page.goto(url);

  const handle = await page.waitForFunction(
    () => {
      const globals = globalThis as Record<string, unknown>;

      if (globals.__storyRendered || globals.__storyError !== undefined) {
        return { error: globals.__storyError as string | undefined };
      }

      return null;
    },
    { timeout },
  );

  const { error } = (await handle.jsonValue()) as StoryState;

  if (error !== undefined) {
    throw new Error(`Story failed to render: ${error}`);
  }
}
