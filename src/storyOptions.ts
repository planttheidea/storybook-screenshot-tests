import type { Page } from '@playwright/test';
import type { Manifest } from './manifest.js';

/**
 * Per-story capture options, read from the story's `screenshotOptions`
 * parameter. Storybook merges parameters from the preview, the meta, and the
 * story, so these can be set at any of those levels.
 *
 * ```ts
 * const meta = {
 *   parameters: { screenshotOptions: { now: '2026-10-04' } },
 * } satisfies Meta<typeof Calendar>;
 * ```
 */
export interface ScreenshotStoryOptions {
  /** Pins the clock for this story's capture, over the config's `now`. */
  now?: Date | string;
}

/** Story options normalized to JSON-safe values, as stored in the manifest. */
export interface ResolvedStoryOptions {
  now?: string;
}

/** What reading one story's parameters produced: its raw options, or why they could not be read. */
export type ExtractedStoryOptions = { options: unknown } | { error: string };

/**
 * Validates a story's raw `screenshotOptions` and normalizes `now` to an
 * ISO string. Throws naming the story, since a typo here would otherwise
 * silently capture at the wrong time.
 * @internal Exported for tests.
 */
export function resolveStoryOptions(storyKey: string, raw: unknown): ResolvedStoryOptions {
  if (raw == null) {
    return {};
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Story "${storyKey}" has a \`screenshotOptions\` parameter that is not an object.`);
  }

  const { now } = raw as ScreenshotStoryOptions;

  if (now === undefined) {
    return {};
  }

  const date = now instanceof Date || typeof now === 'string' ? new Date(now) : undefined;

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(
      `Story "${storyKey}" has a \`screenshotOptions.now\` of ${JSON.stringify(now)}, `
        + 'which is not a valid date. Use a `Date` or an ISO string.',
    );
  }

  return { now: date.toISOString() };
}

/**
 * Returns the manifest with each story's options attached. A story whose
 * parameters could not be read keeps the defaults; its own test fails on
 * render with the real error, which says more than anything reported here.
 */
export function applyStoryOptions(
  manifest: Manifest,
  extracted: Record<string, ExtractedStoryOptions>,
  logDebug: (message: string) => void,
): Manifest {
  return {
    ...manifest,
    stories: manifest.stories.map((story) => {
      const result = extracted[story.id];

      if (!result) {
        return story;
      }

      if ('error' in result) {
        logDebug(`could not read parameters of ${story.id}: ${result.error}`);

        return story;
      }

      return { ...story, storyOptions: resolveStoryOptions(story.key, result.options) };
    }),
  };
}

/**
 * Reads each story's `screenshotOptions` parameter from a page that already
 * has the Storybook preview loaded.
 *
 * Parameters are absent from `index.json`; only the preview has them, after
 * importing the story's file. Its story store does that import and the merge
 * of preview, meta, and story parameters. Returns `undefined` when the preview
 * exposes no story store, so a Storybook without one runs on the config's
 * defaults rather than failing outright.
 */
export async function extractStoryOptions(
  page: Page,
  storyIds: string[],
): Promise<Record<string, ExtractedStoryOptions> | undefined> {
  return page.evaluate(async (ids): Promise<Record<string, ExtractedStoryOptions> | undefined> => {
    const preview = (
      globalThis as unknown as {
        __STORYBOOK_PREVIEW__?: {
          storyStoreValue?: {
            loadStory: (input: { storyId: string }) => Promise<{ parameters?: Record<string, unknown> }>;
          };
        };
      }
    ).__STORYBOOK_PREVIEW__;
    const store = preview?.storyStoreValue;

    if (!store) {
      return undefined;
    }

    const results = await Promise.allSettled(ids.map((storyId) => store.loadStory({ storyId })));

    const extracted: Record<string, ExtractedStoryOptions> = {};

    ids.forEach((storyId, index) => {
      const result = results[index] as PromiseSettledResult<{ parameters?: Record<string, unknown> }>;

      extracted[storyId] =
        result.status === 'fulfilled'
          ? { options: result.value.parameters?.screenshotOptions }
          : { error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
    });

    return extracted;
  }, storyIds);
}
