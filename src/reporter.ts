import { relative } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';
import color from 'picocolors';

const TRAILING_ZERO = /\.0$/;

/** Formats milliseconds as a readable duration, e.g. "1m14s", "4.2s", "736ms". */
function getFormattedDuration(milliseconds: number): string {
  if (milliseconds >= 60_000) {
    const minutes = Math.floor(milliseconds / 60_000);
    const seconds = Math.floor((milliseconds % 60_000) / 1000);

    return `${minutes}m${seconds}s`;
  }

  if (milliseconds >= 1000) {
    const seconds = (milliseconds / 1000).toFixed(1).replace(TRAILING_ZERO, '');

    return `${seconds}s`;
  }

  return `${Math.round(milliseconds)}ms`;
}

/**
 * Playwright colors its error messages, and those codes are noise once the text
 * is re-indented under a heading. `stripVTControlCharacters` handles the whole
 * escape sequence rather than the visible tail a hand-written pattern catches.
 */
function getErrorText(error: TestError): string {
  const text = error.message ?? error.value ?? error.stack ?? 'Unknown error';

  return stripVTControlCharacters(text).trim();
}

function getIndented(text: string, prefix = '    '): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

interface Failure {
  title: string;
  errors: TestError[];
  /** Files written for the failure — the expected, actual, and diff images, and the trace. */
  attachmentPaths: string[];
  /** What the test wrote to stdout and stderr, such as `debug` output. */
  output: string;
}

/**
 * Joins what a test wrote to stdout and stderr. Workers' console output reaches
 * the reporter here rather than the terminal, so a reporter that drops it hides
 * everything `debug` logged for the test.
 * @internal Exported for tests.
 */
export function getTestOutput(result: Pick<TestResult, 'stdout' | 'stderr'>): string {
  return [...result.stdout, ...result.stderr]
    .map((chunk) => (typeof chunk === 'string' ? chunk : chunk.toString('utf-8')))
    .join('')
    .trimEnd();
}

/**
 * Paths of a result's file attachments, relative to the working directory so
 * they can be found in a downloaded CI artifact.
 * @internal Exported for tests.
 */
export function getAttachmentPaths(attachments: TestResult['attachments'], cwd = process.cwd()): string[] {
  return attachments.flatMap((attachment) => (attachment.path ? [relative(cwd, attachment.path)] : []));
}

export interface ScreenshotReporterOptions {
  /** Prints the Storybook server's output for the whole run, not only while it starts. */
  debug?: boolean;
}

/**
 * One line per screenshot, plus enough on failure to act without opening a trace.
 *
 * Run-level errors and a closing summary are reported as well: a suite that
 * registers no tests exits non-zero with nothing else to show, and silence
 * there reads as a broken runner rather than a fixable setup problem.
 */
export class ScreenshotReporter implements Reporter {
  private failures: Failure[] = [];
  private runErrors: TestError[] = [];
  private passedCount = 0;
  private skippedCount = 0;
  private testsStarted = false;
  private readonly debug: boolean;

  /** Options arrive from the reporter's entry in the Playwright config, `[path, options]`. */
  constructor({ debug = false }: ScreenshotReporterOptions = {}) {
    this.debug = debug;
  }

  /**
   * Called once Playwright has applied every filter — `--project`, `--grep`,
   * `--last-failed`, a test path, affected stories — and before the first test
   * starts, so this count is the run as it will actually happen.
   */
  onBegin(_config: FullConfig, suite: Suite): void {
    this.testsStarted = true;

    const count = suite.allTests().length;

    if (count > 0) {
      console.log(`Capturing ${count} screenshot${count === 1 ? '' : 's'}.\n`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const projectName = test.parent.project()?.name ?? 'unknown';
    const titlePath = test.titlePath().slice(3);

    let status = color.yellow('-');

    if (result.status === 'passed') {
      status = color.green('✓');
      this.passedCount++;
    } else if (result.status === 'failed' || result.status === 'timedOut') {
      status = color.red('✘');
      this.failures.push({
        title: `${projectName} › ${titlePath.join(' › ')}`,
        errors: result.errors,
        attachmentPaths: getAttachmentPaths(result.attachments),
        output: getTestOutput(result),
      });
    } else {
      this.skippedCount++;
    }

    const label = titlePath.join(color.cyan(' › '));

    console.log(`${status} ${color.gray(`[${projectName}]`)} ${label} (${getFormattedDuration(result.duration)})`);
  }

  /**
   * Output that belongs to no test — chiefly the Storybook server's, which
   * Playwright hands to reporters, prefixed `[WebServer]`, rather than writing
   * it itself. A reporter without these hooks drops it silently, whatever
   * `storybookServer.stdout` says. A test's own output is left for its failure
   * block, so it is not printed twice.
   *
   * Server output is printed while the server starts, where a failure explains
   * the otherwise bare "Timed out waiting for webServer". Once tests begin it is
   * printed only with `debug`: what follows is runtime logging, then the noise
   * of the server being stopped — Nx, for one, reports a stopped task as one
   * that "did not complete".
   */
  onStdOut(chunk: string | Buffer, test?: TestCase): void {
    if (this.isRunOutputShown(test)) {
      process.stdout.write(chunk);
    }
  }

  onStdErr(chunk: string | Buffer, test?: TestCase): void {
    if (this.isRunOutputShown(test)) {
      process.stderr.write(chunk);
    }
  }

  private isRunOutputShown(test: TestCase | undefined): boolean {
    return !test && (!this.testsStarted || this.debug);
  }

  /** Errors that belong to the run rather than to a test — a config or load failure. */
  onError(error: TestError): void {
    this.runErrors.push(error);
  }

  onEnd(result: FullResult): void {
    for (const { title, errors, attachmentPaths, output } of this.failures) {
      console.log(`\n${color.red('✘')} ${color.bold(title)}`);

      if (output) {
        console.log(getIndented(color.gray(output)));
      }

      for (const error of errors) {
        console.log(getIndented(getErrorText(error)));
      }

      for (const attachmentPath of attachmentPaths) {
        console.log(getIndented(color.gray(attachmentPath)));
      }
    }

    for (const error of this.runErrors) {
      console.log(`\n${color.red('Run error')}`);
      console.log(getIndented(getErrorText(error)));
    }

    const totalCount = this.passedCount + this.failures.length + this.skippedCount;

    if (totalCount === 0 && result.status !== 'interrupted') {
      console.log(
        color.yellow(
          [
            '',
            'No screenshot tests were registered.',
            'Either the manifest is empty, or the library and the runner are using',
            'different copies of @playwright/test — tests registered against one copy',
            'are invisible to the other. Check that @playwright/test resolves to a',
            'single installation from both the application and the library.',
            '',
          ].join('\n'),
        ),
      );

      return;
    }

    const parts = [color.green(`${this.passedCount} passed`)];

    if (this.failures.length > 0) {
      parts.push(color.red(`${this.failures.length} failed`));
    }

    if (this.skippedCount > 0) {
      parts.push(color.yellow(`${this.skippedCount} skipped`));
    }

    console.log(`\n${parts.join(color.gray(', '))}`);
  }
}
