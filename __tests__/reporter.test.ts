import { stripVTControlCharacters } from 'node:util';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAttachmentPaths, getTestOutput, ScreenshotReporter } from '../src/reporter.js';

let output: string[];

beforeEach(() => {
  output = [];
  vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
    output.push(stripVTControlCharacters(String(message)));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createTest(title: string): TestCase {
  return {
    parent: { project: () => ({ name: 'light' }) },
    titlePath: () => ['', 'light', 'run.screenshot.ts', 'foundation', 'Button', title],
  } as unknown as TestCase;
}

function createResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    status: 'passed',
    duration: 1200,
    errors: [],
    attachments: [],
    stdout: [],
    stderr: [],
    ...overrides,
  } as TestResult;
}

function begin(reporter: ScreenshotReporter, count: number): void {
  reporter.onBegin({} as FullConfig, { allTests: () => Array.from({ length: count }) } as unknown as Suite);
}

function end(reporter: ScreenshotReporter, status: FullResult['status'] = 'passed'): void {
  reporter.onEnd({ status } as FullResult);
}

describe('ScreenshotReporter', () => {
  it('announces the filtered count up front', () => {
    const reporter = new ScreenshotReporter();

    begin(reporter, 3);

    expect(output[0]).toBe('Capturing 3 screenshots.\n');
  });

  it('uses the singular for one screenshot', () => {
    const reporter = new ScreenshotReporter();

    begin(reporter, 1);

    expect(output[0]).toBe('Capturing 1 screenshot.\n');
  });

  it('prints one line per test with its project, title path, and duration', () => {
    const reporter = new ScreenshotReporter();

    reporter.onTestEnd(createTest('Primary'), createResult());

    expect(output[0]).toBe('✓ [light] foundation › Button › Primary (1.2s)');
  });

  it('prints each failure with its errors and attachments after the run', () => {
    const reporter = new ScreenshotReporter();

    reporter.onTestEnd(
      createTest('Primary'),
      createResult({
        status: 'failed',
        errors: [{ message: 'Screenshot mismatch' }],
        attachments: [
          { name: 'diff', contentType: 'image/png', path: `${process.cwd()}/output/Primary-diff.png` },
          { name: 'note', contentType: 'text/plain', body: Buffer.from('inline') },
        ],
      }),
    );
    end(reporter, 'failed');

    const text = output.join('\n');

    expect(text).toContain('✘ light › foundation › Button › Primary');
    expect(text).toContain('    Screenshot mismatch');
    expect(text).toContain('    output/Primary-diff.png');
    expect(text).toContain('0 passed, 1 failed');
  });

  it('prints what a failing test wrote, such as its debug output', () => {
    const reporter = new ScreenshotReporter();

    reporter.onTestEnd(
      createTest('Primary'),
      createResult({ status: 'failed', stdout: ['[channel] storyMissing\n'], stderr: [Buffer.from('warning\n')] }),
    );
    end(reporter, 'failed');

    const text = output.join('\n');

    expect(text).toContain('    [channel] storyMissing');
    expect(text).toContain('    warning');
  });

  it('counts a timed-out test as a failure', () => {
    const reporter = new ScreenshotReporter();

    reporter.onTestEnd(createTest('Primary'), createResult({ status: 'timedOut' }));
    end(reporter, 'failed');

    expect(output.at(-1)).toBe('\n0 passed, 1 failed');
  });

  it('summarizes passes and skips', () => {
    const reporter = new ScreenshotReporter();

    reporter.onTestEnd(createTest('Primary'), createResult());
    reporter.onTestEnd(createTest('Secondary'), createResult({ status: 'skipped' }));
    end(reporter);

    expect(output.at(-1)).toBe('\n1 passed, 1 skipped');
  });

  it('prints run-level errors', () => {
    const reporter = new ScreenshotReporter();

    reporter.onError({ message: 'Global setup failed' });
    reporter.onTestEnd(createTest('Primary'), createResult());
    end(reporter, 'failed');

    const text = output.join('\n');

    expect(text).toContain('Run error');
    expect(text).toContain('    Global setup failed');
  });

  it('explains an empty run rather than staying silent', () => {
    const reporter = new ScreenshotReporter();

    end(reporter);

    expect(output.join('\n')).toContain('No screenshot tests were registered.');
  });

  it('stays quiet about an empty run that was interrupted', () => {
    const reporter = new ScreenshotReporter();

    end(reporter, 'interrupted');

    expect(output.join('\n')).not.toContain('No screenshot tests were registered.');
  });
});

describe('getAttachmentPaths', () => {
  it('lists file attachments relative to the working directory', () => {
    expect(
      getAttachmentPaths(
        [
          { name: 'actual', contentType: 'image/png', path: '/app/output/a-actual.png' },
          { name: 'trace', contentType: 'application/zip', path: '/app/output/trace.zip' },
        ],
        '/app',
      ),
    ).toEqual(['output/a-actual.png', 'output/trace.zip']);
  });

  it('skips attachments carried inline rather than as files', () => {
    expect(getAttachmentPaths([{ name: 'note', contentType: 'text/plain', body: Buffer.from('x') }], '/app')).toEqual(
      [],
    );
  });
});

describe('getTestOutput', () => {
  it('joins stdout and stderr, decoding buffers', () => {
    expect(getTestOutput({ stdout: ['one\n', Buffer.from('two\n')], stderr: ['three\n'] })).toBe('one\ntwo\nthree');
  });

  it('returns an empty string when the test wrote nothing', () => {
    expect(getTestOutput({ stdout: [], stderr: [] })).toBe('');
  });
});

describe('ScreenshotReporter output outside tests', () => {
  it('writes server output, which belongs to no test', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    new ScreenshotReporter().onStdOut('[WebServer] ready\n');

    expect(write).toHaveBeenCalledWith('[WebServer] ready\n');
  });

  it('writes server errors to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    new ScreenshotReporter().onStdErr('[WebServer] failed\n');

    expect(write).toHaveBeenCalledWith('[WebServer] failed\n');
  });

  it("leaves a test's own output for its failure block", () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    new ScreenshotReporter().onStdOut('[channel] storyMissing\n', createTest('Primary'));

    expect(write).not.toHaveBeenCalled();
  });
});
