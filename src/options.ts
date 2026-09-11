import type { PlaywrightTestConfig } from '@playwright/test';

/** A single capture variant — one device/theme combination producing one baseline per story. */
export interface ScreenshotProjectOptions {
  /** Directory name the baselines land in, e.g. `light-desktop`. */
  name: string;
  /**
   * A descriptor from Playwright's `devices` registry, e.g. `devices['Pixel 7']`.
   * Imported and passed by the config file rather than looked up by name here,
   * so this package never loads `@playwright/test` itself — Playwright refuses
   * to be loaded twice in one process.
   */
  device?: Record<string, unknown>;
  /**
   * Storybook globals serialized into the story URL. A preview decorator that
   * writes `data-theme` from a global cannot be driven by `colorScheme` alone —
   * the value has to travel in the URL.
   */
  globals?: Record<string, string>;
  colorScheme?: 'light' | 'dark';
  viewport?: { width: number; height: number };
  /** Merged into the generated project's `use`, last. */
  use?: Record<string, unknown>;
}

/** Storybook tags that select and classify stories. Defaults match the documented convention. */
export interface TagOptions {
  /** Stories carrying this tag (or a `<tag>:*` variant) are captured. */
  screenshot: string;
  /** Stories carrying this tag are registered with `test.fixme()`. */
  failing: string;
  /** Prefix whose suffix groups stories in the reporter, e.g. `domain:budgets`. */
  domainPrefix: string;
}

export interface AffectedOptions {
  /**
   * Git ref to diff against. When unset, every story runs — the behavior local
   * dev and post-merge builds want.
   */
  baseRef?: string;
  /**
   * Passed to dependency-cruiser. `enhancedResolveOptions.conditionNames` is the
   * field that decides whether a workspace package resolves to its source or to
   * its build output, and so whether editing that package re-runs any story at all.
   */
  cruiseOptions?: Record<string, unknown>;
  /** Lockfile to watch for dependency bumps, relative to the repository root. */
  lockfile?: string;
}

/** Fields merged into the generated Storybook `webServer` entry. */
export interface StorybookServerOptions {
  /**
   * Environment for the server process. Nx in particular needs `NX_DAEMON` and
   * `NX_TUI` set to `'false'`, so the Storybook process stays inside the group
   * Playwright kills — otherwise a stale server survives to answer the next run.
   */
  env?: Record<string, string>;
/**
   * Signal to ask with, and how long to wait, before the group is killed.
   * Defaults to `SIGTERM` after 5 seconds, which is what keeps a Storybook
   * server from outliving the run and answering for the next one.
   */
  gracefulShutdown?: { signal: 'SIGINT' | 'SIGTERM'; timeout: number };
  timeout?: number;
  cwd?: string;
  reuseExistingServer?: boolean;
  stdout?: 'pipe' | 'ignore';
  stderr?: 'pipe' | 'ignore';
}

export interface ScreenshotConfigOptions {
  /** Where Storybook is served. */
  storybookUrl?: string;
  /** Command that starts Storybook, run from the repository root. */
  storybookCommand?: string;
  /** Overrides merged into the generated `webServer` entry. */
  storybookServer?: StorybookServerOptions;
  /**
   * Set when the Storybook command goes through Nx.
   *
   * Playwright shuts the server down by killing the process group it spawned.
   * Nx's TUI runs the task in a pseudo-terminal and its daemon is a detached
   * process, so either one can leave the Storybook server outside that group
   * and still listening after the run — the port stays held, and the next run
   * silently reuses a stale server. This runs the task in-process instead, so
   * the whole tree stays killable.
   */
  nx?: boolean;
  /**
   * Directory the config file sits in, and the base every baseline path is
   * resolved against. Detected from the caller when omitted.
   */
  rootDir?: string;
  /** Where the generated stub and manifests are written, relative to `rootDir`. */
  generatedDir?: string;
  /**
   * Pins the clock for every capture. Without it, date-relative content —
   * chart axis labels, "Today" headers, relative-date fixtures — drifts between runs.
   */
  fixedTime?: Date | string;
  projects: ScreenshotProjectOptions[];
  tags?: Partial<TagOptions>;
  affected?: AffectedOptions;
  /** Merged into Playwright's `defineConfig` after the generated defaults. */
  playwright?: PlaywrightTestConfig;
}

/** Fully defaulted options, serialized to disk so every process reads the same values. */
export interface ResolvedOptions {
  storybookUrl: string;
  storybookCommand: string | undefined;
  storybookServer: StorybookServerOptions;
  nx: boolean;
  rootDir: string;
  generatedDir: string;
  fixedTime: string | undefined;
  projects: ScreenshotProjectOptions[];
  tags: TagOptions;
  affected: AffectedOptions;
}

const DEFAULT_TAGS: TagOptions = {
  screenshot: 'screenshot',
  failing: 'screenshot:failing',
  domainPrefix: 'domain:',
};

/** Applies defaults and normalizes `fixedTime` to an ISO string so the result is JSON-safe. */
export function resolveOptions(options: ScreenshotConfigOptions, rootDir: string): ResolvedOptions {
  const fixedTime = options.fixedTime;

  return {
    storybookUrl: options.storybookUrl ?? process.env.STORYBOOK_URL ?? 'http://localhost:6006',
    storybookCommand: options.storybookCommand,
    storybookServer: options.storybookServer ?? {},
    nx: options.nx ?? false,
    rootDir,
    generatedDir: options.generatedDir ?? '__generated__/screenshots',
    fixedTime: fixedTime instanceof Date ? fixedTime.toISOString() : fixedTime,
    projects: options.projects,
    tags: { ...DEFAULT_TAGS, ...options.tags },
    affected: options.affected ?? {},
  };
}
