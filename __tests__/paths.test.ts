import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getRepositoryRoot } from '../src/paths.js';

describe('getRepositoryRoot', () => {
  it('finds the root from inside a repository', () => {
    expect(getRepositoryRoot(join(import.meta.dirname, '..', 'src'))).toBe(join(import.meta.dirname, '..'));
  });

  it('falls back to the given directory outside a repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'screenshot-nogit-'));

    try {
      expect(getRepositoryRoot(outside)).toBe(outside);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
