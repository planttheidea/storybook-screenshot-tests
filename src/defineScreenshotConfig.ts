import { dirname, relative, resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import { setGeneratedFiles } from './generateFiles.js';
import type { ScreenshotConfigOptions, ScreenshotProjectOptions } from './options.js';
import { resolveOptions } from './options.js';
import { GENERATED_DIR_VARIABLE, getCallerFile, getRepositoryRoot } from './paths.js';

/**
 * Keeps an Nx-launched Storybook inside the process group Playwright kills.
 * The daemon and the TUI each run the task somewhere Playwright's group kill
 * cannot reach, which leaves the server listening after the run.
 */
const STORYBOOK_DIRECTORY = '.storybook';

const NX_ENVIRONMENT = {
  // biome-ignore lint/style/useNamingConvention: environment variable names.
  NX_DAEMON: 'false',
  // biome-ignore lint/style/useNamingConvention: environment variable names.
  NX_TUI: 'false',
};

/**
 * Neutralizes OS-level font rendering differences (FreeType on Linux, CoreText
 * on macOS) that would otherwise break a zero-tolerance pixel threshold.
 */
const LAUNCH_OPTIONS = {
  args: ['--disable-lcd-text', '--disable-font-subpixel-positioning', '--font-render-hinting=none'],
};

function createProject(project: ScreenshotProjectOptions) {
  return {
    name: project.name,
    use: {
      ...project.device,
      launchOptions: LAUNCH_OPTIONS,
      ...(project.colorScheme ? { colorScheme: project.colorScheme } : {}),
      ...(project.viewport ? { viewport: project.viewport } : {}),
      storybookGlobals: project.globals ?? {},
      ...project.use,
    },
  };
}

/**
 * Builds a Playwright config that captures every screenshot-tagged Storybook
 * story, writing each baseline to a `__screenshots__` folder beside the file the
 * story came from.
 *
 * Side effect by design: the generated directory is written here, during config
 * load, because that is the only point that runs ahead of every Playwright
 * entry path — a normal run, `--list`, UI mode, and the editor extensions.
 *
 * Returns a plain config object rather than calling Playwright's `defineConfig`,
 * which only echoes its argument. Importing it would load `@playwright/test`
 * from this package's own resolution path, and Playwright throws on being
 * loaded a second time in one process.
 */
export function defineScreenshotConfig(options: ScreenshotConfigOptions): PlaywrightTestConfig {
  const callerFile = getCallerFile();
  const rootDirectory = options.rootDir ?? (callerFile ? dirname(callerFile) : process.cwd());
  const repositoryRoot = getRepositoryRoot(rootDirectory);
  const resolved = resolveOptions(options, rootDirectory, [
    // This config module: every consumer has one, no story imports it, and a new
    // project or a different viewport in it moves every baseline.
    ...(callerFile ? [relative(repositoryRoot, callerFile)] : []),
    // Storybook's own configuration, for the same reason — a preview decorator
    // or a global stylesheet it pulls in reaches every story without any story
    // importing it.
    relative(repositoryRoot, resolve(rootDirectory, STORYBOOK_DIRECTORY)),
  ]);
  const generatedDirectory = resolve(rootDirectory, resolved.generatedDir);

  setGeneratedFiles(generatedDirectory, resolved);

  // Read by global setup and by every test worker, neither of which is handed
  // the config at the moment it needs these values.
  process.env[GENERATED_DIR_VARIABLE] = generatedDirectory;

  const isContinuousIntegration = !!process.env.CI;
  const serverEnvironment = {
    ...(resolved.nx ? NX_ENVIRONMENT : {}),
    ...resolved.storybookServer.env,
  };
  const webServer = resolved.storybookCommand
    ? {
        command: resolved.storybookCommand,
        url: resolved.storybookUrl,
        reuseExistingServer: !isContinuousIntegration,
        cwd: repositoryRoot,
        timeout: 120_000,
        // Ask first, force second: Storybook closes its own sockets on SIGTERM,
        // and anything still standing after that is killed with the group.
        // Without it a Vite server can outlive the run and answer for the next
        // one, which reads as a mysteriously stale set of screenshots.
        gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 },
        ...resolved.storybookServer,
        // After the spread, so the Nx defaults are not dropped along with it.
        ...(Object.keys(serverEnvironment).length > 0 ? { env: serverEnvironment } : {}),
      }
    : undefined;

  const config: PlaywrightTestConfig = {
    testDir: generatedDirectory,
    testMatch: '**/*.screenshot.ts',
    globalSetup: resolve(generatedDirectory, 'global-setup.ts'),
    reporter: isContinuousIntegration
      ? [['github'], [resolve(generatedDirectory, 'reporter.ts')]]
      : resolve(generatedDirectory, 'reporter.ts'),
    retries: 0,
    workers: isContinuousIntegration ? 1 : undefined,
    outputDir: resolve(generatedDirectory, 'output'),
    use: {
      // biome-ignore lint/style/useNamingConvention: `baseURL` is Playwright's property name.
      baseURL: resolved.storybookUrl,
      trace: 'on-first-retry',
      timezoneId: 'UTC',
    },
    expect: {
      timeout: 30_000,
      toHaveScreenshot: {
        maxDiffPixelRatio: 0,
        animations: 'disabled',
      },
    },
    // Playwright joins an array snapshot name without sanitizing it, then
    // resolves the result against this config's directory — so the segments
    // built from each story's importPath land beside the story.
    snapshotPathTemplate: '{arg}{ext}',
    ...(webServer ? { webServer } : {}),
    projects: resolved.projects.map(createProject),
    ...options.playwright,
  };

  return config;
}
