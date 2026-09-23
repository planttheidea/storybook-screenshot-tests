# storybook-screenshot-tests CHANGELOG

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
