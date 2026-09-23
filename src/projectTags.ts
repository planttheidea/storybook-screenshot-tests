const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function getEscaped(value: string): string {
  return value.replace(REGEXP_SPECIAL, '\\$&');
}

/**
 * Playwright tag marking a test as captured in one project, e.g.
 * `@screenshot:tablet`. Only tests narrowed to specific projects carry these;
 * a test captured everywhere carries none.
 */
export function getProjectTag(screenshotTag: string, projectName: string): string {
  return `@${screenshotTag}:${projectName}`;
}

/**
 * The `grep` a project uses to collect only its own tests: every test with no
 * project tag, plus those tagged for this project.
 *
 * Filtering by `grep` rather than skipping inside the test means a narrowed
 * story is never registered for the other projects — it is not reported as
 * skipped, and `--list` counts only what actually runs.
 *
 * Playwright matches against the title path and tags joined by spaces, so a tag
 * is bounded by a space or the end of the string. That keeps `tablet` from
 * matching `tablet-landscape`.
 */
export function getProjectGrep(screenshotTag: string, projectName: string): RegExp {
  const prefix = getEscaped(`@${screenshotTag}:`);

  return new RegExp(`^(?!.*(?:^| )${prefix})|(?:^| )${prefix}${getEscaped(projectName)}(?: |$)`);
}
