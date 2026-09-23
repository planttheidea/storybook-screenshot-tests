import { TestType, PlaywrightTestArgs, PlaywrightTestOptions, PlaywrightWorkerArgs, PlaywrightWorkerOptions, expect, PlaywrightTestConfig, BrowserType } from '@playwright/test';
import { Reporter, FullConfig, Suite, TestCase, TestResult, TestError, FullResult } from '@playwright/test/reporter';

/** A single capture variant — one device/theme combination producing one baseline per story. */
interface ScreenshotProjectOptions {
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
    viewport?: {
        width: number;
        height: number;
    };
    /** Merged into the generated project's `use`, last. */
    use?: Record<string, unknown>;
}
/** Storybook tags that select and classify stories. Defaults match the documented convention. */
interface TagOptions {
    /**
     * Stories carrying this tag are captured in every project. `<tag>:<project>`
     * captures a story in that project only, several of them in exactly those,
     * and any of them replaces the bare tag rather than adding to it.
     */
    screenshot: string;
    /** Stories carrying this tag are registered with `test.fixme()`. */
    failing: string;
    /**
     * Stories carrying this tag are not captured, whatever else they carry —
     * how one story opts out of a tag inherited from its meta.
     */
    disabled: string;
    /** Prefix whose suffix groups stories in the reporter, e.g. `domain:budgets`. */
    domainPrefix: string;
}
interface AffectedOptions {
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
interface StorybookServerOptions {
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
    gracefulShutdown?: {
        signal: 'SIGINT' | 'SIGTERM';
        timeout: number;
    };
    timeout?: number;
    cwd?: string;
    reuseExistingServer?: boolean;
    stdout?: 'pipe' | 'ignore';
    stderr?: 'pipe' | 'ignore';
}
interface ScreenshotConfigOptions {
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
declare function defineScreenshotConfig(options: ScreenshotConfigOptions): PlaywrightTestConfig;

/**
 * Runs once before the suite, in the runner process, ahead of test discovery.
 *
 * 1. Neutralizes host fontconfig differences Playwright's Chromium cannot parse.
 * 2. Fetches Storybook's story index.
 * 3. Narrows to the stories affected by the current diff, when a base ref is set.
 * 4. Writes the manifest the test workers read at module load.
 * 5. Removes baselines for stories that no longer exist.
 * 6. Warms Storybook on the first story, so the first test does not pay for the cold start.
 *
 * Takes the runner's own `chromium` so the warm-up uses the browsers the tests
 * will use, rather than whichever Playwright installation this package resolves to.
 */
declare function globalSetup(browserType: BrowserType): Promise<void>;

interface ScreenshotOptions {
    /**
     * Storybook globals applied to every story URL in this project, e.g.
     * `{ theme: 'dark' }`. Declared as a fixture option so each project can set
     * its own, and so the library never needs to know what any of them mean.
     */
    storybookGlobals: Record<string, string>;
}
type WorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;
/** The `test` object exported by `@playwright/test`, before this library extends it. */
type BaseTest = TestType<PlaywrightTestArgs & PlaywrightTestOptions, WorkerArgs>;
/** The `expect` object exported by `@playwright/test`. */
type BaseExpect = typeof expect;
type ScreenshotTest = TestType<PlaywrightTestArgs & PlaywrightTestOptions & ScreenshotOptions, WorkerArgs>;
/**
 * Extends the runner's own `test` with the per-project Storybook globals.
 *
 * The base object is passed in rather than imported. Playwright's test registry
 * lives inside the `@playwright/test` module instance, so tests registered
 * against a second copy — which is what a linked or portalled checkout of this
 * package resolves to — are invisible to the runner, and the suite exits with
 * zero tests and no explanation.
 */
declare function createScreenshotTest(base: BaseTest): ScreenshotTest;

interface RegisterScreenshotTestsInput {
    /** The runner's own `test`, so registrations land in the registry it collects from. */
    test: BaseTest;
    /** The runner's own `expect`, so `toHaveScreenshot` resolves against the active config. */
    expect: BaseExpect;
}
/**
 * Builds the test tree from the manifest written by global setup.
 *
 * Called at module load from the generated stub, because Playwright collects
 * tests when it loads a file — there is no fixture or `testInfo` yet, which is
 * why the manifest travels through disk rather than through the config object.
 */
declare function registerScreenshotTests({ test: baseTest, expect }: RegisterScreenshotTestsInput): void;

/**
 * One line per screenshot, plus enough on failure to act without opening a trace.
 *
 * Run-level errors and a closing summary are reported as well: a suite that
 * registers no tests exits non-zero with nothing else to show, and silence
 * there reads as a broken runner rather than a fixable setup problem.
 */
declare class ScreenshotReporter implements Reporter {
    private failures;
    private runErrors;
    private passedCount;
    private skippedCount;
    /**
     * Called once Playwright has applied every filter — `--project`, `--grep`,
     * `--last-failed`, a test path, affected stories — and before the first test
     * starts, so this count is the run as it will actually happen.
     */
    onBegin(_config: FullConfig, suite: Suite): void;
    onTestEnd(test: TestCase, result: TestResult): void;
    /** Errors that belong to the run rather than to a test — a config or load failure. */
    onError(error: TestError): void;
    onEnd(result: FullResult): void;
}

/** One story, reduced to what the test tree and the baseline path need. */
interface StoryRecord {
    /** `"Components/AccountSignIn/ValidationError"` — title path plus space-stripped story name. */
    key: string;
    id: string;
    importPath: string;
    domain: string;
    failing: boolean;
    /** Names of the projects this story is captured in — every project, unless its tags name specific ones. */
    projects: string[];
}
interface Manifest {
    stories: StoryRecord[];
    /** Story import paths present in Storybook, before any affected filtering. */
    allImportPaths: string[];
    /** Screenshots this run captures — one per story per project it is captured in. */
    capturedCount: number;
    /** Screenshots across every tagged story, before any affected filtering. */
    totalCount: number;
}

export { ScreenshotReporter, createScreenshotTest, defineScreenshotConfig, globalSetup, registerScreenshotTests };
export type { AffectedOptions, BaseTest, Manifest, RegisterScreenshotTestsInput, ScreenshotConfigOptions, ScreenshotOptions, ScreenshotProjectOptions, ScreenshotTest, StoryRecord, StorybookServerOptions, TagOptions };
