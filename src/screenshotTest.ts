import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
  expect as baseExpect,
} from '@playwright/test';

export interface ScreenshotOptions {
  /**
   * Storybook globals applied to every story URL in this project, e.g.
   * `{ theme: 'dark' }`. Declared as a fixture option so each project can set
   * its own, and so the library never needs to know what any of them mean.
   */
  storybookGlobals: Record<string, string>;
}

type WorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

/** The `test` object exported by `@playwright/test`, before this library extends it. */
export type BaseTest = TestType<PlaywrightTestArgs & PlaywrightTestOptions, WorkerArgs>;

/** The `expect` object exported by `@playwright/test`. */
export type BaseExpect = typeof baseExpect;

export type ScreenshotTest = TestType<PlaywrightTestArgs & PlaywrightTestOptions & ScreenshotOptions, WorkerArgs>;

/**
 * Extends the runner's own `test` with the per-project Storybook globals.
 *
 * The base object is passed in rather than imported. Playwright's test registry
 * lives inside the `@playwright/test` module instance, so tests registered
 * against a second copy — which is what a linked or portalled checkout of this
 * package resolves to — are invisible to the runner, and the suite exits with
 * zero tests and no explanation.
 */
export function createScreenshotTest(base: BaseTest): ScreenshotTest {
  return base.extend<ScreenshotOptions>({
    storybookGlobals: [{}, { option: true }],
  });
}
