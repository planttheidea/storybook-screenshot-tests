import { describe, expect, it } from 'vitest';
import { getProjectGrep, getProjectTag } from '../src/projectTags.js';

/** Mirrors how Playwright builds the string a project's `grep` is tested against. */
function getGrepTitle(titlePath: string[], tags: string[] = []): string {
  return [...titlePath, ...tags].join(' ');
}

describe('getProjectTag', () => {
  it('prefixes the screenshot tag with @, as Playwright requires', () => {
    expect(getProjectTag('screenshot', 'tablet')).toBe('@screenshot:tablet');
  });
});

describe('getProjectGrep', () => {
  const tablet = getProjectGrep('screenshot', 'tablet');
  const title = ['run.screenshot.ts', 'accounts', 'Button', 'Default'];

  it('collects a test with no project tags', () => {
    expect(tablet.test(getGrepTitle(title))).toBe(true);
  });

  it('collects a test tagged for this project', () => {
    expect(tablet.test(getGrepTitle(title, ['@screenshot:tablet']))).toBe(true);
    expect(tablet.test(getGrepTitle(title, ['@screenshot:mobile', '@screenshot:tablet']))).toBe(true);
  });

  it('skips a test tagged only for other projects', () => {
    expect(tablet.test(getGrepTitle(title, ['@screenshot:mobile']))).toBe(false);
  });

  it('does not treat a longer project name as a match', () => {
    expect(tablet.test(getGrepTitle(title, ['@screenshot:tablet-landscape']))).toBe(false);
    expect(getProjectGrep('screenshot', 'tablet-landscape').test(getGrepTitle(title, ['@screenshot:tablet']))).toBe(
      false,
    );
  });

  it('escapes project names and tags that contain regular expression syntax', () => {
    const grep = getProjectGrep('vrt.v2', 'desktop (1x)');

    expect(grep.test(getGrepTitle(title, ['@vrt.v2:desktop (1x)']))).toBe(true);
    expect(grep.test(getGrepTitle(title, ['@vrt.v2:mobile']))).toBe(false);
  });
});
