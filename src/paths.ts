import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedOptions } from './options.js';

/**
 * Environment variable carrying the absolute generated directory from the
 * config-load process down to `globalSetup` and the test workers. Playwright
 * gives neither of those the config object at the moment they need these
 * values, and workers inherit the runner's environment.
 */
export const GENERATED_DIR_VARIABLE = 'STORYBOOK_SCREENSHOTS_DIR';

const libraryDirectory = dirname(fileURLToPath(import.meta.url));

const STACK_FILE = /\(?(file:\/\/\/[^)\s]+?):\d+:\d+\)?$/;

/**
 * Walks the call stack for the first frame outside this library — the config
 * file that called `defineScreenshotConfig` — and returns its directory.
 * Falls back to the working directory, which is correct when Playwright is
 * invoked from the package it tests.
 */
export function getCallerDirectory(): string {
  const stack = new Error().stack ?? '';

  for (const line of stack.split('\n').slice(1)) {
    const match = STACK_FILE.exec(line.trim());

    if (!match?.[1]) {
      continue;
    }

    const filePath = fileURLToPath(match[1]);

    if (filePath.startsWith(libraryDirectory)) {
      continue;
    }

    return dirname(filePath);
  }

  return process.cwd();
}

/** Absolute path of the generated directory, as published by the config-load process. */
export function getGeneratedDirectory(): string {
  const directory = process.env[GENERATED_DIR_VARIABLE];

  if (!directory) {
    throw new Error(
      `${GENERATED_DIR_VARIABLE} is not set. Screenshot tests must run through a config built by defineScreenshotConfig().`,
    );
  }

  return directory;
}

/** Reads the options written at config load. Available in every process. */
export function getResolvedOptions(): ResolvedOptions {
  return JSON.parse(readFileSync(resolve(getGeneratedDirectory(), 'options.json'), 'utf-8')) as ResolvedOptions;
}

/**
 * Repository root, used as the base for the Storybook server and the dependency
 * graph. Derived rather than configured.
 *
 * Falls back to `cwd` outside a repository. Capturing screenshots does not need
 * git — only affected-story detection does, and that reports its own failure —
 * so a missing repository must not take the whole config down with it.
 */
export function getRepositoryRoot(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return cwd;
  }
}
