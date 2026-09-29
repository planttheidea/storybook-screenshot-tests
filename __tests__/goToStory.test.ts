import { describe, expect, it } from 'vitest';
import { getGlobalsParameter } from '../src/goToStory.js';

describe('getGlobalsParameter', () => {
  it('serializes globals as name:value pairs joined by semicolons', () => {
    expect(getGlobalsParameter({ theme: 'dark', locale: 'en' })).toBe('theme:dark;locale:en');
  });

  it('returns an empty string when there are no globals', () => {
    expect(getGlobalsParameter({})).toBe('');
  });
});
