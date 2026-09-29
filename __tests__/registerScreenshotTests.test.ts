import { describe, expect, it } from 'vitest';
import type { StoryRecord } from '../src/manifest.js';
import { getGroupedStories } from '../src/registerScreenshotTests.js';

function createStory(key: string, domain: string): StoryRecord {
  return {
    key,
    id: key.toLowerCase(),
    importPath: './src/Foo.stories.tsx',
    domain,
    failing: false,
    projects: ['light'],
  };
}

describe('getGroupedStories', () => {
  it('groups by domain, then by component', () => {
    const grouped = getGroupedStories([
      createStory('Components/Button/Primary', 'foundation'),
      createStory('Components/Button/Secondary', 'foundation'),
      createStory('Components/Chart/Line', 'reports'),
    ]);

    expect([...grouped.keys()]).toEqual(['foundation', 'reports']);
    expect(
      grouped
        .get('foundation')
        ?.get('Button')
        ?.map((story) => story.key),
    ).toEqual(['Components/Button/Primary', 'Components/Button/Secondary']);
    expect(grouped.get('reports')?.get('Chart')).toHaveLength(1);
  });

  it('preserves discovery order across interleaved components', () => {
    const grouped = getGroupedStories([
      createStory('Components/Chart/Line', 'foundation'),
      createStory('Components/Button/Primary', 'foundation'),
      createStory('Components/Chart/Bar', 'foundation'),
    ]);

    const byComponent = grouped.get('foundation');

    expect([...(byComponent?.keys() ?? [])]).toEqual(['Chart', 'Button']);
    expect(byComponent?.get('Chart')?.map((story) => story.key)).toEqual([
      'Components/Chart/Line',
      'Components/Chart/Bar',
    ]);
  });

  it('returns nothing for no stories', () => {
    expect(getGroupedStories([]).size).toBe(0);
  });
});
