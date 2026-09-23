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
  /**
   * Stories carrying this tag are captured in every project. `<tag>:<project>`
   * captures a story in that project only, and several combine.
   */
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
  /**
   * Paths whose change captures every story, regardless of the module graph.
   *
   * Affected detection walks what the stories import, which is the right
   * default and blind to everything that reaches a story without being
   * imported by one: a Storybook preview holding global decorators, the
   * stylesheets that preview pulls in, a design-token file the CSS consumes.
   * Change one of those and every baseline moves while the graph reports
   * nothing — so the run captures nothing and the diff ships unchecked.
   *
   * Repository-relative. A directory entry matches everything beneath it, with
   * or without a trailing slash. This config module and the `.storybook`
   * directory beside it are always included, so a project only declares what is
   * specific to it.
   *
   * ```ts
   * affected: {
   *   baseRef: process.env.NX_BASE,
   *   fullRerunPaths: ['apps/web/src/styles'],
   * }
   * ```
   */
  fullRerunPaths?: string[];
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

/**
 * Applies defaults and normalizes `fixedTime` to an ISO string so the result is
 * JSON-safe.
 *
 * `defaultFullRerunPaths` are the ones every consumer shares — this config
 * module and Storybook's own directory — prepended rather than left to each
 * one to declare. A project's own list adds what is specific to it.
 */
export function resolveOptions(
  options: ScreenshotConfigOptions,
  rootDir: string,
  defaultFullRerunPaths: string[] = [],
): ResolvedOptions {
  const fixedTime = options.fixedTime;
  const fullRerunPaths = [...new Set([...defaultFullRerunPaths, ...(options.affected?.fullRerunPaths ?? [])])];
  const tags = { ...DEFAULT_TAGS, ...options.tags };

  // `<tag>:<project>` narrows a story to that project, so a project whose tag
  // is also the failing tag could not be told apart from it.
  const shadowed = options.projects.find((project) => `${tags.screenshot}:${project.name}` === tags.failing);

  if (shadowed) {
    throw new Error(
      `Project "${shadowed.name}" cannot be targeted, because "${tags.failing}" is the failing tag. Rename the project.`,
    );
  }

  return {
    storybookUrl: options.storybookUrl ?? process.env.STORYBOOK_URL ?? 'http://localhost:6006',
    storybookCommand: options.storybookCommand,
    storybookServer: options.storybookServer ?? {},
    nx: options.nx ?? false,
    rootDir,
    generatedDir: options.generatedDir ?? '__generated__/screenshots',
    fixedTime: fixedTime instanceof Date ? fixedTime.toISOString() : fixedTime,
    projects: options.projects,
    tags,
    affected: { ...options.affected, fullRerunPaths },
  };
}
