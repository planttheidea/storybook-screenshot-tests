import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveAffected } from '../src/affected.js';

let repository: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: repository,
    encoding: 'utf-8',
  }).trim();
}

function setFile(relativePath: string, content: string): void {
  const absolute = join(repository, relativePath);

  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

function commit(message: string): string {
  git('add', '.');
  git('commit', '--quiet', '-m', message);

  return git('rev-parse', 'HEAD');
}

const storyImportPaths = ['./src/A.stories.js', './src/B.stories.js'];

function derive(baseRef: string | undefined, fullRerunPaths: string[] = []) {
  return deriveAffected({
    repositoryRoot: repository,
    projectRoot: repository,
    storyImportPaths,
    options: { baseRef, fullRerunPaths },
  });
}

let baseRef: string;

beforeEach(() => {
  repository = mkdtempSync(join(tmpdir(), 'screenshot-affected-'));
  git('init', '--quiet');
  setFile('src/A.stories.js', "import './shared.js';\n");
  setFile('src/B.stories.js', 'export {};\n');
  setFile('src/shared.js', 'export const value = 1;\n');
  setFile('src/styles/tokens.css', ':root {}\n');
  baseRef = commit('initial');
});

afterEach(() => {
  rmSync(repository, { recursive: true, force: true });
});

describe('deriveAffected', () => {
  it('captures everything when no base ref is set', async () => {
    const result = await derive(undefined);

    expect(result.importPaths).toBeUndefined();
    expect(result.reason).toBe('no base ref is set');
  });

  it('captures everything when nothing changed', async () => {
    const result = await derive(baseRef);

    expect(result.importPaths).toBeUndefined();
    expect(result.reason).toBe(`nothing changed since ${baseRef}`);
  });

  it('narrows to the stories that reach a changed file', async () => {
    setFile('src/shared.js', 'export const value = 2;\n');
    commit('change shared');

    const result = await derive(baseRef);

    expect([...(result.importPaths ?? [])]).toEqual(['./src/A.stories.js']);
    expect(result.reason).toContain('reach 1 story file(s)');
  });

  it('names the changed file that forced a full rerun', async () => {
    setFile('src/styles/tokens.css', ':root { --x: 1; }\n');
    commit('change tokens');

    const result = await derive(baseRef, ['src/styles']);

    expect(result.importPaths).toBeUndefined();
    expect(result.reason).toBe('src/styles/tokens.css changed, and it is under a full-rerun path');
  });

  it('explains a base ref missing from history, as in a shallow clone', async () => {
    await expect(derive('does-not-exist')).rejects.toThrow(
      /Could not diff against the base ref "does-not-exist"[\s\S]*fetch-depth: 0/,
    );
  });
});
