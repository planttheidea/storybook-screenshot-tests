import { describe, expect, it, vi } from 'vitest';
import type { Manifest, StoryRecord } from '../src/manifest.js';
import { applyStoryOptions, resolveStoryOptions } from '../src/storyOptions.js';

function createStory(id: string): StoryRecord {
  return {
    key: `Components/Foo/${id}`,
    id,
    importPath: './src/Foo.stories.tsx',
    domain: 'foundation',
    failing: false,
    projects: ['light'],
    storyOptions: {},
  };
}

function createManifest(stories: StoryRecord[]): Manifest {
  return { stories, allImportPaths: ['./src/Foo.stories.tsx'], capturedCount: stories.length, totalCount: 0 };
}

describe('resolveStoryOptions', () => {
  it('returns no options when the parameter is absent', () => {
    expect(resolveStoryOptions('A/One', undefined)).toEqual({});
    expect(resolveStoryOptions('A/One', null)).toEqual({});
    expect(resolveStoryOptions('A/One', {})).toEqual({});
  });

  it('normalizes now from a date or a string to an iso string', () => {
    expect(resolveStoryOptions('A/One', { now: new Date('2026-10-04T12:00:00.000Z') })).toEqual({
      now: '2026-10-04T12:00:00.000Z',
    });
    expect(resolveStoryOptions('A/One', { now: '2026-10-04' })).toEqual({ now: '2026-10-04T00:00:00.000Z' });
  });

  it('throws naming the story for an unparseable now', () => {
    expect(() => resolveStoryOptions('A/One', { now: 'tomorrow' })).toThrow(/"A\/One"[\s\S]*"tomorrow"/);
    expect(() => resolveStoryOptions('A/One', { now: 42 })).toThrow(/not a valid date/);
  });

  it('throws naming the story when the parameter is not an object', () => {
    expect(() => resolveStoryOptions('A/One', '2026-10-04')).toThrow(/"A\/One"[\s\S]*not an object/);
    expect(() => resolveStoryOptions('A/One', [])).toThrow(/not an object/);
  });
});

describe('applyStoryOptions', () => {
  it('attaches each story its own options', () => {
    const manifest = applyStoryOptions(
      createManifest([createStory('one'), createStory('two')]),
      { one: { options: { now: '2026-10-04' } }, two: { options: undefined } },
      vi.fn(),
    );

    expect(manifest.stories.map((story) => story.storyOptions)).toEqual([{ now: '2026-10-04T00:00:00.000Z' }, {}]);
  });

  it('keeps the defaults for a story whose parameters could not be read, and logs why', () => {
    const logDebug = vi.fn();
    const manifest = applyStoryOptions(
      createManifest([createStory('one')]),
      { one: { error: 'Failed to fetch dynamically imported module' } },
      logDebug,
    );

    expect(manifest.stories[0]?.storyOptions).toEqual({});
    expect(logDebug).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch dynamically imported module'));
  });

  it('keeps the defaults for a story missing from the results', () => {
    expect(applyStoryOptions(createManifest([createStory('one')]), {}, vi.fn()).stories[0]?.storyOptions).toEqual({});
  });
});
