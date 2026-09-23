# `@planttheidea/storybook-screenshot-tests`

Storybook screenshot testing as a drop-in to an application. Tag the stories you want captured, point Playwright at a
config built by `defineScreenshotConfig`, and every tagged story is captured once per variant with its baseline written
beside the file the story came from.

```sh
yarn add --dev @planttheidea/storybook-screenshot-tests @playwright/test
yarn playwright install chromium
```

ESM only, and `@playwright/test` is a peer dependency at `>=1.56.0` — one installation of it, resolved the same way from
your application and from this package. [Why that matters.](#api)

There is no test file to write and no list of stories to maintain. Stories are discovered from Storybook's own index on
every run, the test tree is built from that, and baselines for stories that no longer exist are deleted.

- [`@planttheidea/storybook-screenshot-tests`](#planttheideastorybook-screenshot-tests)
  - [Setup](#setup)
    - [Tagging stories](#tagging-stories)
    - [Running](#running)
  - [Where baselines live](#where-baselines-live)
  - [Projects](#projects)
  - [Tags](#tags)
    - [Targeting projects](#targeting-projects)
    - [Known failures](#known-failures)
    - [Domains](#domains)
  - [Affected stories only](#affected-stories-only)
    - [What the graph cannot see](#what-the-graph-cannot-see)
    - [Dependency and build-output widening](#dependency-and-build-output-widening)
  - [Determinism](#determinism)
  - [The Storybook server](#the-storybook-server)
  - [How it works](#how-it-works)
  - [API](#api)
    - [`defineScreenshotConfig(options)`](#definescreenshotconfigoptions)
    - [The rest](#the-rest)
  - [Troubleshooting](#troubleshooting)
  - [License](#license)

## Setup

One config file is the whole integration. It lives wherever you want the baselines rooted — typically alongside the
Storybook project it tests.

```ts
// playwright.screenshots.ts
import { defineScreenshotConfig } from '@planttheidea/storybook-screenshot-tests';
import { devices } from '@playwright/test';

export default defineScreenshotConfig({
  storybookCommand: 'yarn storybook --ci',
  storybookUrl: 'http://localhost:6006',
  fixedTime: '2024-06-01T12:00:00.000Z',
  projects: [
    { name: 'light-desktop', viewport: { width: 1280, height: 800 } },
    { name: 'dark-desktop', viewport: { width: 1280, height: 800 }, globals: { theme: 'dark' } },
    { name: 'light-mobile', device: devices['Pixel 7'] },
  ],
});
```

`devices` is imported by your config and passed in, rather than looked up by name inside this package, because
Playwright throws when it is loaded twice in one process. For the same reason the returned value is a plain config
object instead of the result of Playwright's `defineConfig` — which only echoes its argument anyway.

### Tagging stories

A story is captured when it carries the `screenshot` tag, on the story itself or inherited from its meta.

```ts
// src/components/AccountSignIn/AccountSignIn.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { AccountSignIn } from './AccountSignIn';

const meta = {
  component: AccountSignIn,
  tags: ['screenshot', 'domain:accounts'],
  title: 'Components/AccountSignIn',
} satisfies Meta<typeof AccountSignIn>;

export default meta;

export const Default: StoryObj<typeof meta> = {};

export const ValidationError: StoryObj<typeof meta> = {
  args: { error: 'That password is not right.' },
};
```

### Running

```jsonc
{
  "scripts": {
    "test:screenshots": "playwright test --config=playwright.screenshots.ts",
    "test:screenshots:update": "playwright test --config=playwright.screenshots.ts --update-snapshots",
  },
}
```

Every Playwright entry point works against this config, including `--list`, `--ui`, and the editor extensions.

## Where baselines live

A baseline is written next to the story that produced it, in a `__screenshots__` directory keyed by project name:

```
src/components/AccountSignIn/
├── AccountSignIn.stories.tsx
├── AccountSignIn.tsx
└── __screenshots__/
    ├── dark-desktop/
    │   ├── AccountSignIn-Default.png
    │   └── AccountSignIn-ValidationError.png
    └── light-desktop/
        ├── AccountSignIn-Default.png
        └── AccountSignIn-ValidationError.png
```

The file name is the component name — the last segment of the story's `title` — joined to the story name with its spaces
removed. The directory comes from the story's `importPath`, so a moved story file moves its baselines with it.

Global setup walks the tree for `__screenshots__` directories on every run and removes any file that no story claims,
then prunes the directories left empty. Untag a story, rename it, delete it, or narrow it to fewer projects, and the
baselines it no longer produces go away in the same run — there is nothing to clean up by hand.

Everything the run generates for itself goes in `generatedDir` (`__generated__/screenshots` by default), which is
written with a `.gitignore` of its own. It does not need an entry in yours.

## Projects

Each entry in `projects` is one capture variant, producing one baseline per story captured in it — every tagged story,
unless [its tags target specific projects](#targeting-projects). Beyond `name`, every field is optional:

| Field         | What it does                                                             |
| ------------- | ------------------------------------------------------------------------ |
| `name`        | Directory the baselines land in, and the label in reporter output        |
| `device`      | A descriptor from Playwright's `devices` registry                        |
| `viewport`    | `{ width, height }`, applied over whatever `device` sets                 |
| `colorScheme` | `'light'` or `'dark'`, as the `prefers-color-scheme` the browser reports |
| `globals`     | Storybook globals serialized into each story URL                         |
| `use`         | Merged into the generated project's `use`, last                          |

`colorScheme` and `globals` are separate on purpose. A preview decorator that writes a `data-theme` attribute from a
Storybook global cannot be driven by the browser's color scheme — that value has to travel in the URL, which is what
`globals` does. Themes built on the media query want `colorScheme`; themes built on a global want `globals`; a theme
built on both wants both.

## Tags

| Option              | Default               | What it selects                                                  |
| ------------------- | --------------------- | ---------------------------------------------------------------- |
| `tags.screenshot`   | `screenshot`          | Stories to capture, in every project or in the projects named    |
| `tags.failing`      | `screenshot:failing`  | Stories registered with `test.fixme()` instead of being captured |
| `tags.disabled`     | `screenshot:disabled` | Stories not captured at all, whatever else they carry            |
| `tags.domainPrefix` | `domain:`             | Prefix whose suffix groups stories in the reporter               |

### Targeting projects

The bare `screenshot` tag captures a story in every project. `screenshot:<project>` captures it in that project only,
and several of them capture it in exactly those:

```ts
export const Sidebar: StoryObj<typeof meta> = {
  tags: ['screenshot:tablet', 'screenshot:tablet-landscape'],
};
```

Project tags replace the bare tag rather than adding to it. Storybook merges a story's tags with its meta's into one
list, so a meta tagged `screenshot` and a story tagged `screenshot:tablet` reads as a story carrying both — and the
story is captured on the tablet only, which is almost always what narrowing a story means.

To take one story out of a meta-wide tag altogether, tag it `screenshot:disabled`. It wins over everything else the
story carries:

```ts
const meta = { tags: ['screenshot'] /* ... */ } satisfies Meta<typeof Board>;

export const Collapsed: StoryObj<typeof meta> = { tags: ['screenshot:tablet'] };

export const Animated: StoryObj<typeof meta> = { tags: ['screenshot:disabled'] };
```

A targeted story is never registered for the other projects, rather than being registered and skipped, so it doesn't
show up in their reporter output, in `--list`, or in the count printed before the run. Tagging a story with a project
that doesn't exist throws, naming the story, so a typo can't quietly capture too much or nothing at all. A project can't
be named `failing` or `disabled`, since its tag would collide with those.

Under the hood each project gets a Playwright `grep` that picks out its own tests, and targeted tests carry tags like
`@screenshot:tablet`. A `grep` you set through the `playwright` option doesn't reach the projects; use `--grep` on the
command line instead, which still applies on top.

### Known failures

`screenshot:failing` both selects a story and marks it, so a story that is known to be broken stays in the suite,
reported as expected-to-fail, without a second tag. On its own it keeps the story in every project; alongside a project
tag, only that project:

```ts
export const PendingRedesign: StoryObj<typeof meta> = {
  tags: ['screenshot:failing'],
};
```

### Domains

The domain tag only affects grouping. A story tagged `domain:accounts` is reported under `accounts`; one with no domain
tag is reported under `uncategorized`.

Override any of them when your workspace already has a tag convention:

```ts
defineScreenshotConfig({
  tags: { screenshot: 'vrt', failing: 'vrt:failing', disabled: 'vrt:off', domainPrefix: 'team:' },
  projects: [...],
});
```

## Affected stories only

Set `affected.baseRef` and only the stories reachable from files changed since that ref are captured:

```ts
defineScreenshotConfig({
  affected: { baseRef: process.env.BASE_REF },
  projects: [...],
});
```

When the ref is unset, or nothing changed, every story runs — which is what local development and post-merge builds
want. A CI job for a pull request sets it to the merge base; anything else leaves it alone.

The story files themselves are the entry points to the dependency graph, cruised with
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser). Nothing outside what the stories actually reach is
walked, so `node_modules` falls out without an exclusion rule. A changed file that is itself a story short-circuits the
walk, so a newly added story is captured even though the graph predates it.

### What the graph cannot see

A story reads more than it imports. Storybook's preview decorates every story, the stylesheets that preview pulls in
style every story, and this config decides how every story is captured — and no story imports any of them. Change one
and every baseline moves while the graph reports nothing, so the run captures nothing and the diff ships unchecked.

The config module and the `.storybook` directory beside it are therefore always full-rerun triggers. Anything else in
that shape is declared per project, repository-relative, a directory entry covering everything beneath it:

```ts
defineScreenshotConfig({
  affected: {
    baseRef: process.env.BASE_REF,
    fullRerunPaths: ['apps/web/src/styles', 'packages/tokens'],
  },
  projects: [...],
});
```

This check runs before the dependency graph is built, so a full rerun costs nothing to detect.

### Dependency and build-output widening

Two more things deliberately widen back out to the full suite. A lockfile change that touches a package the stories
reach is treated as able to move a pixel, so every story is captured — `affected.lockfile` pins which lockfile to read
when the default detection guesses wrong. And a workspace package the graph reached through `dist` (or `build`, `lib`,
`out-tsc`) rather than through source is reported as a warning, because edits to that package's source change no file
the graph knows about:

```
Resolved 1 workspace package(s) to build output rather than source:
  ../../packages/design-system
Edits to their source will not re-run any story. Add an export condition
pointing at source, and list it in `affected.cruiseOptions`.
```

The fix is on the package: give its export map a condition that points at source, then name that condition so the graph
follows it.

```ts
defineScreenshotConfig({
  affected: {
    baseRef: process.env.BASE_REF,
    cruiseOptions: { enhancedResolveOptions: { conditionNames: ['source', 'import', 'require'] } },
  },
  projects: [...],
});
```

## Determinism

The generated config is built for a zero-tolerance pixel threshold (`maxDiffPixelRatio: 0`), which only holds if
everything that could drift is pinned. Handled for you:

- **Fonts.** Chromium launches with LCD text, subpixel positioning, and render hinting disabled, so FreeType and
  CoreText produce the same glyphs. On Linux hosts shipping fontconfig 2.17's `48-guessfamily.conf` — which the older
  fontconfig statically linked into Playwright's Chromium cannot parse, silently falling back to the default font for
  families like Georgia — a filtered copy of the host configuration is built in the temp directory and `FONTCONFIG_FILE`
  is pointed at it.
- **Animations.** Disabled at capture time.
- **Time zone.** `UTC` for every run.
- **Assets.** After a story reports rendered, images, stylesheets, and scripts still in flight are awaited, then one
  animation frame, so nothing lands between render and capture.
- **The clock**, if you set `fixedTime`. Without it, date-relative content — chart axis labels, "Today" headers,
  relative-date fixtures — drifts between runs. Takes a `Date` or an ISO string.

Retries are off, since a retried screenshot comparison tells you nothing a first one didn't. On CI, workers are capped
at one and Playwright's `github` reporter is added alongside this package's own.

Anything else is yours to override through `playwright`, which is merged over the generated config last:

```ts
defineScreenshotConfig({
  playwright: { expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } }, timeout: 60_000 },
  projects: [...],
});
```

## The Storybook server

Give `storybookCommand` and Playwright starts Storybook itself, from the repository root, reusing an already-running
server locally but never on CI. Leave it off and the run expects something already listening at `storybookUrl`.

The server is asked to stop with `SIGTERM` and given five seconds before the process group is killed. That matters more
than it sounds: a Vite server that outlives the run keeps the port, and the next run quietly reuses the stale server —
which reads as a mysteriously wrong set of screenshots rather than as a server problem.

For the same reason there is an `nx` flag. Nx's TUI runs a task in a pseudo-terminal and its daemon is detached, so
either one can leave Storybook outside the group Playwright kills. Setting `nx: true` sets `NX_DAEMON` and `NX_TUI` to
`false` for the server process, keeping the whole tree killable.

```ts
defineScreenshotConfig({
  nx: true,
  storybookCommand: 'yarn nx run design-system:storybook',
  storybookServer: { timeout: 180_000, stdout: 'pipe' },
  projects: [...],
});
```

## How it works

Worth knowing when something surprises you, because the ordering explains most of the constraints:

1. **Config load.** `defineScreenshotConfig` resolves your options, writes them to `options.json`, and writes the
   generated directory: a test stub, a global-setup entry, and a reporter entry. This happens during config load because
   that is the only point ahead of _every_ Playwright entry path — a normal run, `--list`, UI mode, the editor
   extensions. Files are only rewritten when their content changes, so an editor watching the directory isn't woken on
   every run.
2. **Global setup**, in the runner process, before test discovery. Applies the fontconfig override, fetches Storybook's
   `/index.json`, narrows to affected stories when a base ref is set, writes `manifest.json`, cleans up orphaned
   baselines, and warms Storybook on the first story so the first test doesn't pay for the cold start.
3. **Test registration**, at module load in each worker. The stub calls `registerScreenshotTests` with the runner's own
   `test` and `expect`, and the tree is built from the manifest — grouped by domain, then component, then story.

The generated files live in your application rather than inside this package for three reasons: Playwright does not
transform anything under `node_modules`; `globalSetup` and `reporter` are configured as paths rather than as values; and
that location is where `@playwright/test` resolves to the runner's own copy. The manifest travels through disk rather
than through the config object because Playwright collects tests when it loads a file, and there is no fixture or
`testInfo` at that moment.

## API

### `defineScreenshotConfig(options)`

Returns the Playwright config. `projects` is the only required option.

| Option             | Default                                         | Notes                                                 |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| `projects`         | —                                               | Capture variants; see [Projects](#projects)           |
| `storybookUrl`     | `process.env.STORYBOOK_URL` or `localhost:6006` | Where Storybook is served                             |
| `storybookCommand` | none                                            | Command that starts Storybook, from the repo root     |
| `storybookServer`  | `{}`                                            | Overrides merged into the generated `webServer`       |
| `nx`               | `false`                                         | Keeps an Nx-launched server inside the killable group |
| `rootDir`          | directory of the calling config file            | Base every baseline path resolves against             |
| `generatedDir`     | `__generated__/screenshots`                     | Relative to `rootDir`                                 |
| `fixedTime`        | none                                            | `Date` or ISO string, pinned for every capture        |
| `tags`             | see [Tags](#tags)                               | Story selection and grouping                          |
| `affected`         | `{}`                                            | See [Affected stories](#affected-stories-only)        |
| `playwright`       | `{}`                                            | Merged over the generated config, last                |

### The rest

The other exports exist for the generated files to import, and are documented here because you will read them in that
directory. You don't normally call them yourself.

| Export                    | What it is                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `globalSetup(chromium)`   | The global-setup step. Takes the runner's own `chromium` so warm-up uses its browsers |
| `registerScreenshotTests` | Builds the test tree. Takes the runner's own `test` and `expect`                      |
| `createScreenshotTest`    | Extends a `test` object with the `storybookGlobals` fixture option                    |
| `ScreenshotReporter`      | The exact count up front, one line per screenshot, a block per failure, and a summary |

Types are exported for all of it: `ScreenshotConfigOptions`, `ScreenshotProjectOptions`, `StorybookServerOptions`,
`TagOptions`, `AffectedOptions`, `RegisterScreenshotTestsInput`, `ScreenshotOptions`, `ScreenshotTest`, `BaseTest`,
`Manifest`, and `StoryRecord`.

Each of these takes the runner's objects as arguments rather than importing them, and that is the load-bearing detail of
the whole package. Playwright's test registry lives inside the `@playwright/test` module instance, so tests registered
against a second copy are invisible to the runner.

## Troubleshooting

**"No screenshot tests were registered."** Either the manifest is empty, or two copies of `@playwright/test` are in
play, with the library registering against one and the runner collecting from the other. Most often that is a linked or
portalled checkout of this package carrying its own `@playwright/test` in `node_modules`. Check that it resolves to a
single installation from both the application and the library.

**`No stories tagged "screenshot" were found.`** Global setup found the Storybook index but nothing in it carried the
tag. Tag the stories, then let Storybook refresh its index.

**Screenshots differ and nothing changed.** Usually a stale Storybook server answering from a previous run's port. Check
for a listener on `storybookUrl` before the run, and if the server is launched through Nx, set `nx: true`.

**A story's baselines never go stale.** Look for a build-output warning in global setup. A workspace package resolved
through `dist` is invisible to affected-story detection, so the stories depending on it never re-run under a base ref.

**`STORYBOOK_SCREENSHOTS_DIR is not set.`** Something ran a screenshot test outside a config built by
`defineScreenshotConfig` — that variable is how the generated directory reaches global setup and the workers.

## License

[MIT](./LICENSE)
