import type { Page } from '@playwright/test';
import type { DebugLogger } from './debugLogger.js';
import { createDebugLogger } from './debugLogger.js';

interface Channel {
  emit: (event: string, ...args: unknown[]) => unknown;
  on: (event: string, callback: (payload?: unknown) => void) => unknown;
  once: (event: string, callback: (payload?: unknown) => void) => unknown;
}

interface StoryError {
  event: string;
  payload: unknown;
}

interface StoryState {
  error: StoryError | undefined;
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
    setDebugListeners(page, createDebugLogger(debug));
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

            // The page's console, which the debug logger forwards as `[page:log]`.
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

        // Storybook sends plain objects over the channel, not `Error` instances,
        // so the payload is kept whole and formatted outside the page. Cloned
        // through JSON so it survives the trip back.
        // `Error` instances are unpacked by hand — JSON drops every field of one.
        const getSerializable = (value: unknown): unknown => {
          if (value instanceof Error) {
            return { name: value.name, message: value.message, stack: value.stack };
          }

          return Array.isArray(value) ? value.map(getSerializable) : value;
        };

        const setError = (event: string) => (payload: unknown) => {
          let serialized: unknown;

          try {
            serialized = JSON.parse(JSON.stringify(getSerializable(payload) ?? null));
          } catch {
            serialized = String(payload);
          }

          globals.__storyError = { event, payload: serialized };
        };

        channel.once('configError', setError('configError'));
        channel.once('playFunctionThrewException', setError('playFunctionThrewException'));
        channel.once('storyErrored', setError('storyErrored'));
        channel.once('storyMissing', setError('storyMissing'));
        channel.once('storyThrewException', setError('storyThrewException'));
        channel.once('unhandledErrorsWhilePlaying', setError('unhandledErrorsWhilePlaying'));

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
            setError('storyFinished')(payload);
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
    throw new Error(
      `Story did not render within ${timeout}ms (${getRenderPhaseDescription(await getRenderPhase(page))}).`,
      {
        cause: error,
      },
    );
  }

  const { error } = (await handle.jsonValue()) as StoryState;

  if (error !== undefined) {
    const hint = getStoryErrorHint(error.event);

    throw new Error(
      `Story failed to render (${error.event}): ${getStoryErrorMessage(error.payload)}${hint ? `\n${hint}` : ''}`,
    );
  }
}

/**
 * Formats a Storybook channel error payload. Exceptions arrive as
 * `{ name, message, stack }`, render errors as `{ title, description }`, a
 * missing story as its id, unhandled play errors as a list of any of these, and
 * an unsuccessful `storyFinished` as `{ status }`.
 * @internal Exported for tests.
 */
export function getStoryErrorMessage(payload: unknown): string {
  if (payload == null) {
    return 'no details were given';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(getStoryErrorMessage).join('\n');
  }

  if (typeof payload === 'object') {
    const { description, message, stack, status, title } = payload as Record<string, unknown>;

    // A stack already opens with the name and message, and says where it came from.
    if (typeof stack === 'string' && stack) {
      return stack;
    }

    if (typeof message === 'string' && message) {
      return message;
    }

    if (typeof title === 'string' || typeof description === 'string') {
      return [title, description].filter((part) => typeof part === 'string' && part).join(': ');
    }

    if (typeof status === 'string') {
      return `the story finished with status "${status}"`;
    }
  }

  return JSON.stringify(payload);
}

/**
 * Explains an event whose payload says little on its own. `storyMissing` carries
 * only the story id, and Storybook sends it both for an id absent from the index
 * and for a story file that failed to import — the import error itself goes to
 * the page console.
 * @internal Exported for tests.
 */
export function getStoryErrorHint(event: string): string | undefined {
  if (event === 'storyMissing') {
    return (
      'Storybook could not load this story: either its id is not in the index, or its file failed to import. '
      + 'The import error is logged to the page console — set `debug: true` to see it. On a Vite dev server, a '
      + '504 "Outdated Optimize Dep" there means dependencies were re-optimized mid-run.'
    );
  }

  return undefined;
}

/**
 * Describes how far the story got, which separates a preview that never loaded
 * (a failed import, a server reload mid-request) from a story stuck rendering.
 * @internal Exported for tests.
 */
export function getRenderPhaseDescription(phase: unknown): string {
  if (phase === null) {
    return 'the page could not be read';
  }

  return typeof phase === 'string' ? `last render phase: ${phase}` : 'the preview never started rendering';
}

/**
 * The last render phase the story reported — `undefined` when it reported none,
 * `null` when the page itself cannot be read.
 */
async function getRenderPhase(page: Page): Promise<unknown> {
  try {
    return await page.evaluate(() => (globalThis as Record<string, unknown>).__storyPhase);
  } catch {
    return null;
  }
}

/**
 * Forwards what the page reports to stdout. Error responses matter most here: a
 * Vite dev server re-optimizing dependencies answers in-flight module requests
 * with `504 Outdated Optimize Dep`, and the story that asked for them never renders.
 */
function setDebugListeners(page: Page, logDebug: DebugLogger): void {
  page.on('console', (message) => {
    logDebug(`[page:${message.type()}] ${message.text()}`);
  });

  page.on('pageerror', (error) => {
    logDebug(`[pageerror] ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    logDebug(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      logDebug(`[response:${response.status()}] ${response.url()}`);
    }
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      logDebug(`[navigated] ${frame.url()}`);
    }
  });
}
