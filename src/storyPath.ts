/** Strips the leading `./` Storybook puts on every `importPath`. */
function getNormalizedImportPath(importPath: string): string {
  return importPath.replace(/^\.\//, '');
}

/**
 * Extracts the component name from a Storybook title path by taking the last
 * segment, e.g. `"Components/AccountSignIn"` → `"AccountSignIn"`.
 */
export function getComponentName(title: string): string {
  return title.slice(title.lastIndexOf('/') + 1);
}

export interface StoryKeyParts {
  /** Full Storybook title path, e.g. `"Components/AccountSignIn"`. */
  title: string;
  /** Story name with spaces removed, e.g. `"ValidationError"`. */
  name: string;
  /** Last segment of `title` — the component name. */
  componentName: string;
}

/** Splits `"Components/AccountSignIn/ValidationError"` into its parts. */
export function getStoryKeyParts(key: string): StoryKeyParts {
  const lastSlash = key.lastIndexOf('/');
  const title = key.slice(0, lastSlash);
  const name = key.slice(lastSlash + 1);

  return { title, name, componentName: getComponentName(title) };
}

/**
 * Derives the baseline path for a story as segments relative to the config
 * directory, placing it in a `__screenshots__` folder beside the file the story
 * came from.
 *
 * Playwright resolves an array passed to `toHaveScreenshot` with `path.join`
 * and no sanitization, then resolves the result against the config directory —
 * so these segments reach disk intact.
 */
export function deriveBaselineSegments(importPath: string, key: string, projectName: string): string[] {
  const { componentName, name } = getStoryKeyParts(key);
  const directorySegments = getNormalizedImportPath(importPath).split('/').slice(0, -1);

  return [...directorySegments, '__screenshots__', projectName, `${componentName}-${name}.png`];
}

/** Directory holding a story's baselines, relative to the config directory. */
export function deriveBaselineDirectory(importPath: string): string {
  return [...getNormalizedImportPath(importPath).split('/').slice(0, -1), '__screenshots__'].join('/');
}
