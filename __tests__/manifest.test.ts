import { describe, expect, it } from 'vitest';
import { deriveManifest, getStoryProjects } from '../src/manifest.js';
import type { TagOptions } from '../src/options.js';

const tags: TagOptions = {
  screenshot: 'screenshot',
  failing: 'screenshot:failing',
  disabled: 'screenshot:disabled',
  domainPrefix: 'domain:',
};

const projects = ['light', 'dark'];

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
      projects,
    );

    expect(manifest.stories.map((story) => story.key)).toEqual(['A/One']);
    expect(manifest.totalCount).toBe(2);
  });

  it('accepts a suffixed variant of the screenshot tag', () => {
    const manifest = deriveManifest(
      createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['screenshot:failing'] }]),
      tags,
      projects,
    );

    expect(manifest.stories).toHaveLength(1);
    expect(manifest.stories[0]?.failing).toBe(true);
  });

  it('strips spaces from story names when building the key', () => {
    const manifest = deriveManifest(
      createIndex([{ id: 'a--v', title: 'Foundation/Button', name: 'Validation Error', tags: ['screenshot'] }]),
      tags,
      projects,
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
      projects,
    );

    expect(manifest.stories.map((story) => story.domain)).toEqual(['budgets', 'uncategorized']);
  });

  it('honors custom tag names', () => {
    const manifest = deriveManifest(
      createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['visual', 'area:core'] }]),
      { screenshot: 'visual', failing: 'visual:broken', disabled: 'visual:off', domainPrefix: 'area:' },
      projects,
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
      projects,
      new Set(['./src/B/B.stories.tsx']),
    );

    expect(manifest.stories.map((story) => story.key)).toEqual(['B/Two']);
    expect(manifest.capturedCount).toBe(2);
    expect(manifest.totalCount).toBe(4);
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
      projects,
      new Set(['./src/B/B.stories.tsx']),
    );

    expect(manifest.allImportPaths.sort()).toEqual(['./src/A/A.stories.tsx', './src/B/B.stories.tsx']);
  });

  it('deduplicates import paths shared by sibling stories', () => {
    const manifest = deriveManifest(
      createIndex([
        { id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'] },
        { id: 'a--two', title: 'A', name: 'Two', tags: ['screenshot'] },
      ]),
      tags,
      projects,
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
      projects,
    );

    expect(manifest.stories.map((story) => story.key)).toEqual(['A/One']);
  });

  it('throws when a captured story has no import path to derive a location from', () => {
    const index = createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'], importPath: undefined }]);

    expect(() => deriveManifest(index, tags, projects)).toThrow(/no importPath/);
  });

  it('throws when nothing carries the screenshot tag', () => {
    expect(() =>
      deriveManifest(createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: [] }]), tags, projects),
    ).toThrow(/No stories tagged "screenshot"/);
  });

  it('does not throw when every tagged story is filtered out by the affected set', () => {
    const manifest = deriveManifest(
      createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'] }]),
      tags,
      projects,
      new Set(['./src/Other/Other.stories.tsx']),
    );

    expect(manifest.stories).toHaveLength(0);
    expect(manifest.totalCount).toBe(2);
  });
});

describe('deriveManifest project targeting', () => {
  const allProjects = ['desktop', 'tablet', 'tablet-landscape', 'mobile'];

  function getProjects(storyTags: string[]) {
    return getStoryProjects({ title: 'A', name: 'One', tags: storyTags }, tags, allProjects);
  }

  it('captures a bare-tagged story in every project', () => {
    expect(getProjects(['screenshot'])).toEqual(allProjects);
  });

  it('narrows a story to the project its tag names', () => {
    expect(getProjects(['screenshot:tablet'])).toEqual(['tablet']);
  });

  it('combines several project tags, in configured order', () => {
    expect(getProjects(['screenshot:tablet-landscape', 'screenshot:tablet'])).toEqual(['tablet', 'tablet-landscape']);
  });

  it('lets project tags replace the bare tag, as when narrowing a meta-wide tag', () => {
    expect(getProjects(['screenshot', 'screenshot:tablet'])).toEqual(['tablet']);
    expect(getProjects(['screenshot', 'screenshot:tablet', 'screenshot:mobile'])).toEqual(['tablet', 'mobile']);
  });

  it('opts a story out entirely with the disabled tag, whatever else it carries', () => {
    expect(getProjects(['screenshot', 'screenshot:disabled'])).toBeUndefined();
    expect(getProjects(['screenshot:tablet', 'screenshot:failing', 'screenshot:disabled'])).toBeUndefined();
  });

  it('does not count a disabled story as tagged', () => {
    expect(() =>
      deriveManifest(
        createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['screenshot', 'screenshot:disabled'] }]),
        tags,
        allProjects,
      ),
    ).toThrow(/No stories tagged/);
  });

  it('keeps a failing story in every project unless a project is named', () => {
    expect(getProjects(['screenshot:failing'])).toEqual(allProjects);
    expect(getProjects(['screenshot:failing', 'screenshot:mobile'])).toEqual(['mobile']);
  });

  it('does not select a story by a failing tag outside the screenshot namespace', () => {
    expect(() =>
      deriveManifest(
        createIndex([{ id: 'a--one', title: 'A', name: 'One', tags: ['broken'] }]),
        {
          ...tags,
          failing: 'broken',
        },
        allProjects,
      ),
    ).toThrow(/No stories tagged/);
  });

  it('throws on a tag naming a project that does not exist', () => {
    expect(() => getProjects(['screenshot:tablte'])).toThrow(/no project named "tablte"/);
  });

  it('counts screenshots rather than stories', () => {
    const manifest = deriveManifest(
      createIndex([
        { id: 'a--one', title: 'A', name: 'One', tags: ['screenshot'], importPath: './src/A/A.stories.tsx' },
        { id: 'a--two', title: 'A', name: 'Two', tags: ['screenshot:tablet'], importPath: './src/A/A.stories.tsx' },
        {
          id: 'b--one',
          title: 'B',
          name: 'One',
          tags: ['screenshot:tablet', 'screenshot:mobile'],
          importPath: './src/B/B.stories.tsx',
        },
      ]),
      tags,
      allProjects,
      new Set(['./src/B/B.stories.tsx']),
    );

    expect(manifest.capturedCount).toBe(2);
    expect(manifest.totalCount).toBe(7);
  });
});
