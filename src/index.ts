export { defineScreenshotConfig } from './defineScreenshotConfig.js';
export { globalSetup } from './globalSetup.js';
export { registerScreenshotTests } from './registerScreenshotTests.js';
export { ScreenshotReporter } from './reporter.js';
export { createScreenshotTest } from './screenshotTest.js';

export type {
  AffectedOptions,
  ScreenshotConfigOptions,
  ScreenshotProjectOptions,
  StorybookServerOptions,
  TagOptions,
} from './options.js';
export type { RegisterScreenshotTestsInput } from './registerScreenshotTests.js';
export type { BaseTest, ScreenshotOptions, ScreenshotTest } from './screenshotTest.js';
export type { Manifest, StoryRecord } from './manifest.js';
