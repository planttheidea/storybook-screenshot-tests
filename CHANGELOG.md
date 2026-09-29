# storybook-screenshot-tests CHANGELOG

## 2.2.1

Traces are recorded only when `debug` is on. Recording one costs every test, passing or not, and `retain-on-failure` by
default made whole runs noticeably slower. Set `debug: true` to get a trace of each failure.

The Storybook server's output is printed. Playwright passes it to reporters rather than writing it itself, and the
reporter dropped it, so `storybookServer.stdout: 'pipe'` and the default stderr piping showed nothing.

All `debug` output — page console, page errors, failed requests, navigations, and per-test timings, not just global
setup — goes through one logger, prefixed `[screenshots]`, so it can be told apart from the reporter and filtered as
one.

## 2.2.0

### Enhancements

- A failing story reports Storybook's own error message and stack, prefixed with the event that carried it. Payloads
  previously printed as `[object Object]`, or as a bare story id for `storyMissing`, which now explains that the story's
  file may have failed to import.
- Traces are kept for every failed test (`trace: 'retain-on-failure'`). The previous `on-first-retry` never recorded
  one, because retries are off.
- `debug` also pipes the Storybook server's output (unless `storybookServer.stdout` is set), logs the resolved options,
  the fontconfig override, why affected detection captured what it did, the warm-up story and its duration, and each
  test's render and resource timings.
- The reporter prints what each failing test wrote to stdout and stderr, which is where `debug` output from test workers
  lands — it was previously dropped.
- The reporter lists each failure's attachments — expected, actual, and diff images, and the trace — relative to the
  working directory.
- Clearer errors for an unreachable Storybook, a non-JSON index, a missing `options.json`, a base ref missing from
  history (as in a shallow CI clone), a dependency-cruiser failure, a failed warm-up, and resources that never finish
  loading (now listed by URL).

### Bug fixes

- Global setup throws instead of calling `process.exit(1)`, so Playwright reports the error and shuts down the Storybook
  server it started.
- Two stories in one file whose names differ only by spaces (`Foo Bar` and `FooBar`) shared a baseline, one silently
  overwriting the other. That now throws, naming both.

## 2.1.0

### Enhancements

- `debug` option: forwards each story page's console, page errors, failed and error responses, navigations, and every
  Storybook channel event to stdout, in both the warm-up and the tests.
- `warmUpTimeout` option: how long global setup waits for the first story to render (default 60 seconds).
- A render timeout names how far the story got — its last render phase, or that the preview never started rendering.
- Each test waits 20 seconds for its story to render, below Playwright's 30-second test timeout, so the render-phase
  error surfaces instead of the generic test timeout.
- Storybook's `configError`, `storyMissing`, and `unhandledErrorsWhilePlaying` events, and a `storyFinished` without
  success, now fail the story immediately instead of waiting out the timeout.

## 2.0.1

Ensure `page.waitForFunction` respects timeout by passing options as third argument.

## 2.0.0

### Breaking changes

#### Unknown `screenshot:*` tags now throw

`screenshot:<name>` now targets the project called `<name>`, so a tag naming no configured project is treated as a typo
and throws, naming the story and the known projects. Previously any `screenshot:*` variant captured the story in every
project.

#### Projects cannot be named `failing` or `disabled`

A project's targeting tag would collide with the reserved `screenshot:failing` and `screenshot:disabled` tags (or
whatever `tags.failing` and `tags.disabled` are set to), so such a project is rejected at config load.

#### Projects set their own `grep`

Each generated project now sets a `grep` that collects only its own tests. Playwright gives a project's `grep`
precedence over the top-level one, so a `grep` passed through the `playwright` option no longer reaches the projects.
`--grep` on the command line still applies on top.

#### Manifest shape

`StoryRecord` gains `projects`, the projects the story is captured in, and `Manifest`'s `capturedCount` and `totalCount`
are now counted in screenshots (one per story per project) rather than stories.

### Enhancements

- [#2](https://github.com/planttheidea/storybook-screenshot-tests/pull/2) - Add project-targeted tags:
  `screenshot:<project>` captures a story only in that project, and several capture it in exactly those. Any project tag
  replaces the bare `screenshot` tag rather than adding to it, so a story can narrow a tag inherited from its meta.
- [#2](https://github.com/planttheidea/storybook-screenshot-tests/pull/2) - Add `screenshot:disabled` (configurable as
  `tags.disabled`) to opt a story out entirely, whatever else it carries.
- [#2](https://github.com/planttheidea/storybook-screenshot-tests/pull/2) - Print the number of screenshots about to run
  from the reporter, after `--project`, `--grep`, `--last-failed`, and affected-story filtering apply, instead of a
  story count from global setup that those filters could make wrong.
- [#2](https://github.com/planttheidea/storybook-screenshot-tests/pull/2) - Remove the baselines of projects a story is
  no longer captured in during baseline cleanup.

## 1.1.0

- [#1](https://github.com/planttheidea/storybook-screenshot-tests/pull/1) - Add `affected.fullRerunPaths`, capturing
  every story when a listed path changes. The config module and the `.storybook` directory beside it are always
  included.

## 1.0.0

- Initial release
