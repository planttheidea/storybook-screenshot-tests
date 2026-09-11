import { describe, expect, it } from 'vitest';
import { deriveManifest } from '../src/manifest.js';
import type { TagOptions } from '../src/options.js';

const tags: TagOptions = {
  screenshot: 'screenshot',
  failing: 'screenshot:failing',
  domainPrefix: 'domain:',
};

interface EntryInput {
  id: string;
  title: string;
  name: string;
  tags: string[];
  importPath?: string;
  type?: string;
}

function createIndex(entries: EntryInput[]) {
  return {
    v: 5,
    entries: Object.fromEntries(
      entries.map((entry) => [
        entry.id,
        {
          type: 'story',
          importPath: './src/Foo/Foo.stories.tsx',
          ...entry,
        },
      ]),
    ),
  };
}

describe('deriveManifest', () => {
  it('keeps only screenshot-tagged stories', () => {
    const manifest = deriveManifest(
      createIndex([
        { id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'] },
        { id: 'b--two', title: 'B', name: 'Two', tags: ['autodocs'] },
      ]),
      tags,
    );

    expect(manifest.stories.map((story) => story.key)).toEqual(['A/One']);
    expect(manifest.totalCount).toBe(1);
  });

  it('accepts a suffixed variant of the screenshot tag', () => {
    const manifest = deriveManifest(
      createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['screenshot:failing'] }]),
      tags,
    );

    expect(manifest.stories).toHaveLength(1);
    expect(manifest.stories[0]?.failing).toBe(true);
  });

  it('strips spaces from story names when building the key', () => {
    const manifest = deriveManifest(
      createIndex([
        { id: 'a--v', title: 'Foundation/Button', name: 'Validation Error', tags: ['screenshot'] },
      ]),
      tags,
    );

    expect(manifest.stories[0]?.key).toBe('Foundation/Button/ValidationError');
  });

  it('reads the domain from its tag and defaults when absent', () => {
    const manifest = deriveManifest(
      createIndex([
        { id: 'a--one', title: 'A', name: 'One', tags: ['screenshot', 'domain:budgets'] },
        { id: 'b--two', title: 'B', name: 'Two', tags: ['screenshot'] },
      ]),
      tags,
    );

    expect(manifest.stories.map((story) => story.domain)).toEqual(['budgets', 'uncategorized']);
  });

  it('honors custom tag names', () => {
    const manifest = deriveManifest(
      createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['visual', 'area:core'] }]),
      { screenshot: 'visual', failing: 'visual:broken', domainPrefix: 'area:' },
    );

    expect(manifest.stories[0]?.domain).toBe('core');
  });

  it('narrows to the allowed import paths but still reports the total', () => {
    const manifest = deriveManifest(
      createIndex([
        {
          id: 'a--one',
          title: 'A',
          name: 'One',
          tags: ['screenshot'],
          importPath: './src/A/A.stories.tsx',
        },
        {
          id: 'b--two',
          title: 'B',
          name: 'Two',
          tags: ['screenshot'],
          importPath: './src/B/B.stories.tsx',
        },
      ]),
      tags,
      new Set(['./src/B/B.stories.tsx']),
    );

    expect(manifest.stories.map((story) => story.key)).toEqual(['B/Two']);
    expect(manifest.capturedCount).toBe(1);
    expect(manifest.totalCount).toBe(2);
  });

  it('reports every import path regardless of the filter, for graph entry points', () => {
    const manifest = deriveManifest(
      createIndex([
        {
          id: 'a--one',
          title: 'A',
          name: 'One',
          tags: ['screenshot'],
          importPath: './src/A/A.stories.tsx',
        },
        {
          id: 'b--two',
          title: 'B',
          name: 'Two',
          tags: ['screenshot'],
          importPath: './src/B/B.stories.tsx',
        },
      ]),
      tags,
      new Set(['./src/B/B.stories.tsx']),
    );

    expect(manifest.allImportPaths.sort()).toEqual([
      './src/A/A.stories.tsx',
      './src/B/B.stories.tsx',
    ]);
  });

  it('deduplicates import paths shared by sibling stories', () => {
    const manifest = deriveManifest(
      createIndex([
        { id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'] },
        { id: 'a--two', title: 'A', name: 'Two', tags: ['screenshot'] },
      ]),
      tags,
    );

    expect(manifest.allImportPaths).toHaveLength(1);
    expect(manifest.stories).toHaveLength(2);
  });

  it('ignores docs entries', () => {
    const manifest = deriveManifest(
      createIndex([
        { id: 'a--docs', title: 'A', name: 'Docs', tags: ['screenshot'], type: 'docs' },
        { id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'] },
      ]),
      tags,
    );

    expect(manifest.stories.map((story) => story.key)).toEqual(['A/One']);
  });

  it('throws when a captured story has no import path to derive a location from', () => {
    const index = createIndex([
      { id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'], importPath: undefined },
    ]);

    expect(() => deriveManifest(index, tags)).toThrow(/no importPath/);
  });

  it('throws when nothing carries the screenshot tag', () => {
    expect(() =>
      deriveManifest(createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: [] }]), tags),
    ).toThrow(/No stories tagged "screenshot"/);
  });

  it('does not throw when every tagged story is filtered out by the affected set', () => {
    const manifest = deriveManifest(
      createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'] }]),
      tags,
      new Set(['./src/Other/Other.stories.tsx']),
    );

    expect(manifest.stories).toHaveLength(0);
    expect(manifest.totalCount).toBe(1);
  });
});
