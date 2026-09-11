import type {
  FullResult,
  Reporter,
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';
import color from 'picocolors';

const TRAILING_ZERO = /\.0$/;
const ANSI = /\[[0-9;]*m/g;

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

function getErrorText(error: TestError): string {
  const text = error.message ?? error.value ?? error.stack ?? 'Unknown error';

  return text.replace(ANSI, '').trim();
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
}

/**
 * One line per story, plus enough on failure to act without opening a trace.
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
      });
    } else {
      this.skippedCount++;
    }

    const label = titlePath.join(color.cyan(' › '));

    console.log(
      `${status} ${color.gray(`[${projectName}]`)} ${label} (${getFormattedDuration(result.duration)})`,
    );
  }

  /** Errors that belong to the run rather than to a test — a config or load failure. */
  onError(error: TestError): void {
    this.runErrors.push(error);
  }

  onEnd(result: FullResult): void {
    for (const { title, errors } of this.failures) {
      console.log(`\n${color.red('✘')} ${color.bold(title)}`);

      for (const error of errors) {
        console.log(getIndented(getErrorText(error)));
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
