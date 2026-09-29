import type { Page } from '@playwright/test';

interface Channel {
  emit: (event: string, ...args: unknown[]) => unknown;
  on: (event: string, callback: (payload?: unknown) => void) => unknown;
  once: (event: string, callback: (payload?: unknown) => void) => unknown;
}

interface StoryState {
  error: string | undefined;
}

export interface WaitForStoryRenderConfig {
  /** Forwards the page's console, errors, failed requests, and every channel event to stdout. */
  debug?: boolean;
  timeout?: number;
}

/**
 * Navigates to a Storybook story iframe and waits for it to finish rendering,
 * including any play function. Traps the addons channel on assignment so the
 * listener attaches before any story can render, rather than polling.
 *
 * Throws with Storybook's own error message when the story or its play function
 * fails, instead of hanging until the timeout. When it does time out, the error
 * names the last render phase the story reached.
 */
export async function waitForStoryRender(
  page: Page,
  url: string,
  { debug = false, timeout = 30_000 }: WaitForStoryRenderConfig = {},
): Promise<void> {
  if (debug) {
    setDebugListeners(page);
  }

  // Serialized and run in the page, so nothing from this closure exists there —
  // `debug` has to travel as the argument.
  await page.addInitScript((debugEnabled: boolean) => {
    Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
      configurable: true,
      set(channel: Channel) {
        if (debugEnabled) {
          const originalEmit = channel.emit.bind(channel);

          channel.emit = (event, ...args) => {
            let detail;

            try {
              detail = JSON.stringify(args).slice(0, 500);
            } catch {
              detail = '<unserializable>';
            }

            console.log(`[channel] ${event} ${detail}`);

            return originalEmit(event, ...args);
          };
        }

        Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
          configurable: true,
          writable: true,
          value: channel,
        });

        const globals = globalThis as Record<string, unknown>;

        channel.on('storyRenderPhaseChanged', (payload) => {
          if (typeof payload === 'object' && payload != null && 'newPhase' in payload) {
            globals.__storyPhase = payload.newPhase;
          }
        });

        channel.once('storyRendered', () => {
          globals.__storyRendered = true;
        });

        const onError = (payload: unknown) => {
          globals.__storyError = payload instanceof Error ? payload.message : String(payload);
        };

        channel.once('configError', onError);
        channel.once('playFunctionThrewException', onError);
        channel.once('storyErrored', onError);
        channel.once('storyMissing', onError);
        channel.once('storyThrewException', onError);
        channel.once('unhandledErrorsWhilePlaying', onError);

        channel.once('storyFinished', (payload) => {
          if (globals.__storyRendered || globals.__storyError != null) {
            // Already handled, either via successful render or error during the process.
            return;
          }

          if (
            typeof payload == 'object'
            && payload != null
            && (!('status' in payload) || payload.status !== 'success')
          ) {
            // It finished in some unforeseen way, so treat it as an error.
            onError(payload);
          }
        });
      },
    });
  }, debug);

  await page.goto(url);

  let handle;

  try {
    handle = await page.waitForFunction(
      () => {
        const globals = globalThis as Record<string, unknown>;

        return globals.__storyRendered || globals.__storyError != null ? { error: globals.__storyError } : null;
      },
      undefined,
      { timeout },
    );
  } catch (error) {
    throw new Error(`Story did not render within ${timeout}ms (${await getRenderPhaseDescription(page)}).`, {
      cause: error,
    });
  }

  const { error } = (await handle.jsonValue()) as StoryState;

  if (error !== undefined) {
    throw new Error(`Story failed to render: ${error}`);
  }
}

/**
 * Describes how far the story got, which separates a preview that never loaded
 * (a failed import, a server reload mid-request) from a story stuck rendering.
 */
async function getRenderPhaseDescription(page: Page): Promise<string> {
  try {
    const phase = await page.evaluate(() => (globalThis as Record<string, unknown>).__storyPhase);

    return typeof phase === 'string' ? `last render phase: ${phase}` : 'the preview never started rendering';
  } catch {
    return 'the page could not be read';
  }
}

/**
 * Forwards what the page reports to stdout. Error responses matter most here: a
 * Vite dev server re-optimizing dependencies answers in-flight module requests
 * with `504 Outdated Optimize Dep`, and the story that asked for them never renders.
 */
function setDebugListeners(page: Page): void {
  page.on('console', (message) => {
    console.log(`[page:${message.type()}] ${message.text()}`);
  });

  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    console.log(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log(`[response:${response.status()}] ${response.url()}`);
    }
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      console.log(`[navigated] ${frame.url()}`);
    }
  });
}
