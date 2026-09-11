import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanUpBaselines, getBaselineDirectories, getExpectedBaselines } from '../src/cleanUpBaselines.js';
import type { StoryRecord } from '../src/manifest.js';

function createStory(overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    key: 'Foundation/Button/Variants',
    id: 'foundation-button--variants',
    importPath: './src/components/Button/Button.stories.tsx',
    domain: 'foundation',
    failing: false,
    ...overrides,
  };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'screenshot-cleanup-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setBaseline(relativePath: string): string {
  const absolute = resolve(root, relativePath);

  mkdirSync(resolve(absolute, '..'), { recursive: true });
  writeFileSync(absolute, 'png');

  return absolute;
}

describe('getExpectedBaselines', () => {
  it('lists one file per story per project', () => {
    const expected = getExpectedBaselines([createStory()], ['light', 'dark']);

    expect([...(expected.get('src/components/Button/__screenshots__/light') ?? [])]).toEqual(['Button-Variants.png']);
    expect([...(expected.get('src/components/Button/__screenshots__/dark') ?? [])]).toEqual(['Button-Variants.png']);
  });

  it('groups sibling stories from the same file together', () => {
    const expected = getExpectedBaselines(
      [createStory(), createStory({ key: 'Foundation/Button/SectionLink' })],
      ['light'],
    );

    expect([...(expected.get('src/components/Button/__screenshots__/light') ?? [])].sort()).toEqual([
      'Button-SectionLink.png',
      'Button-Variants.png',
    ]);
  });
});

describe('getBaselineDirectories', () => {
  it('finds nested screenshot directories', () => {
    setBaseline('src/components/Button/__screenshots__/light/Button-Variants.png');
    setBaseline('src/deep/nested/Thing/__screenshots__/dark/Thing-Default.png');

    expect(getBaselineDirectories(root).sort()).toEqual([
      'src/components/Button/__screenshots__',
      'src/deep/nested/Thing/__screenshots__',
    ]);
  });

  it('skips build output and dependency directories', () => {
    setBaseline('node_modules/pkg/__screenshots__/light/Thing.png');
    setBaseline('dist/__screenshots__/light/Thing.png');
    setBaseline('src/Ok/__screenshots__/light/Ok-Default.png');

    expect(getBaselineDirectories(root)).toEqual(['src/Ok/__screenshots__']);
  });
});

describe('cleanUpBaselines', () => {
  it('keeps baselines that still have a story', () => {
    const kept = setBaseline('src/components/Button/__screenshots__/light/Button-Variants.png');

    cleanUpBaselines(root, [createStory()], ['light']);

    expect(existsSync(kept)).toBe(true);
  });

  it('removes a baseline whose story is gone', () => {
    const kept = setBaseline('src/components/Button/__screenshots__/light/Button-Variants.png');
    const removed = setBaseline('src/components/Button/__screenshots__/light/Button-Removed.png');

    cleanUpBaselines(root, [createStory()], ['light']);

    expect(existsSync(kept)).toBe(true);
    expect(existsSync(removed)).toBe(false);
  });

  it('removes a directory whose story file was deleted entirely', () => {
    setBaseline('src/components/Gone/__screenshots__/light/Gone-Default.png');
    setBaseline('src/components/Button/__screenshots__/light/Button-Variants.png');

    cleanUpBaselines(root, [createStory()], ['light']);

    expect(existsSync(resolve(root, 'src/components/Gone/__screenshots__'))).toBe(false);
  });

  it('prunes a project directory once it is empty', () => {
    setBaseline('src/components/Button/__screenshots__/retired/Button-Variants.png');
    setBaseline('src/components/Button/__screenshots__/light/Button-Variants.png');

    cleanUpBaselines(root, [createStory()], ['light']);

    expect(existsSync(resolve(root, 'src/components/Button/__screenshots__/retired'))).toBe(false);
    expect(existsSync(resolve(root, 'src/components/Button/__screenshots__/light'))).toBe(true);
  });

  it('keeps baselines for every configured project, not just the first', () => {
    const light = setBaseline('src/components/Button/__screenshots__/light/Button-Variants.png');
    const dark = setBaseline('src/components/Button/__screenshots__/dark/Button-Variants.png');

    cleanUpBaselines(root, [createStory()], ['light', 'dark']);

    expect(existsSync(light)).toBe(true);
    expect(existsSync(dark)).toBe(true);
  });

  it('does nothing when the root does not exist', () => {
    expect(() => {
      cleanUpBaselines(resolve(root, 'absent'), [createStory()], ['light']);
    }).not.toThrow();
  });
});
