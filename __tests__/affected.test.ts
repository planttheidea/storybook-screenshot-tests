import { describe, expect, it } from 'vitest';
import { findAffectedStories, hasFullRerunPathChange } from '../src/affected.js';

const storyFiles = new Set(['src/A/A.stories.tsx', 'src/B/B.stories.tsx']);

// Each key maps to the files that import it.
const reverseGraph: Record<string, string[]> = {
  'libraries/shared/src/palette.ts': ['src/A/Card.tsx', 'src/B/B.stories.tsx'],
  'src/A/Card.tsx': ['src/A/A.stories.tsx'],
  'src/orphan.ts': [],
};

describe('findAffectedStories', () => {
  it('walks upward through intermediate modules to the story', () => {
    expect(findAffectedStories(['libraries/shared/src/palette.ts'], reverseGraph, storyFiles).sort()).toEqual([
      'src/A/A.stories.tsx',
      'src/B/B.stories.tsx',
    ]);
  });

  it('catches a shared library change several hops away', () => {
    expect(findAffectedStories(['src/A/Card.tsx'], reverseGraph, storyFiles)).toEqual(['src/A/A.stories.tsx']);
  });

  it('returns the story itself when the story file changed', () => {
    expect(findAffectedStories(['src/B/B.stories.tsx'], reverseGraph, storyFiles)).toEqual(['src/B/B.stories.tsx']);
  });

  it('returns nothing for a file no story reaches', () => {
    expect(findAffectedStories(['src/orphan.ts'], reverseGraph, storyFiles)).toEqual([]);
  });

  it('returns nothing for a file absent from the graph', () => {
    expect(findAffectedStories(['docs/readme.ts'], reverseGraph, storyFiles)).toEqual([]);
  });

  it('deduplicates stories reached by several changed files', () => {
    expect(
      findAffectedStories(['libraries/shared/src/palette.ts', 'src/A/Card.tsx'], reverseGraph, storyFiles).sort(),
    ).toEqual(['src/A/A.stories.tsx', 'src/B/B.stories.tsx']);
  });

  it('terminates on a dependency cycle', () => {
    const cyclic = { 'src/a.ts': ['src/b.ts'], 'src/b.ts': ['src/a.ts'] };

    expect(findAffectedStories(['src/a.ts'], cyclic, storyFiles)).toEqual([]);
  });

  it('stops at the first story rather than continuing past it', () => {
    const chained = {
      'src/util.ts': ['src/A/A.stories.tsx'],
      'src/A/A.stories.tsx': ['src/B/B.stories.tsx'],
    };

    expect(findAffectedStories(['src/util.ts'], chained, storyFiles)).toEqual(['src/A/A.stories.tsx']);
  });
});

describe('hasFullRerunPathChange', () => {
  it('matches a file named exactly', () => {
    expect(hasFullRerunPathChange(['apps/web/screenshots.config.ts'], ['apps/web/screenshots.config.ts'])).toBe(true);
  });

  it('matches anything beneath a directory entry', () => {
    expect(hasFullRerunPathChange(['apps/web/.storybook/preview.ts'], ['apps/web/.storybook'])).toBe(true);
  });

  it('matches beneath a directory entry written with a trailing slash', () => {
    expect(hasFullRerunPathChange(['apps/web/.storybook/preview.ts'], ['apps/web/.storybook/'])).toBe(true);
  });

  it('does not treat a directory entry as a filename prefix', () => {
    expect(hasFullRerunPathChange(['apps/web/src/styles-legacy.css'], ['apps/web/src/styles'])).toBe(false);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    expect(hasFullRerunPathChange(['apps/web/.storybook-old/preview.ts'], ['apps/web/.storybook'])).toBe(false);
  });

  it('matches when any one of several changed files qualifies', () => {
    expect(hasFullRerunPathChange(['README.md', 'apps/web/.storybook/main.ts'], ['apps/web/.storybook'])).toBe(true);
  });

  it('returns false for changes that touch none of the paths', () => {
    expect(hasFullRerunPathChange(['apps/web/src/Button.tsx'], ['apps/web/.storybook'])).toBe(false);
  });

  it('returns false when no paths are declared', () => {
    expect(hasFullRerunPathChange(['apps/web/.storybook/preview.ts'])).toBe(false);
  });
});
