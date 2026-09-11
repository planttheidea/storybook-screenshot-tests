import { describe, expect, it } from 'vitest';
import {
  deriveBaselineDirectory,
  deriveBaselineSegments,
  getComponentName,
  getStoryKeyParts,
} from '../src/storyPath.js';

describe('getComponentName', () => {
  it('takes the last segment of a title path', () => {
    expect(getComponentName('Components/Forms/AccountSignIn')).toBe('AccountSignIn');
  });

  it('returns the whole title when there is no path', () => {
    expect(getComponentName('Button')).toBe('Button');
  });
});

describe('getStoryKeyParts', () => {
  it('splits a key into title, name, and component name', () => {
    expect(getStoryKeyParts('Components/AccountSignIn/ValidationError')).toEqual({
      title: 'Components/AccountSignIn',
      name: 'ValidationError',
      componentName: 'AccountSignIn',
    });
  });

  it('handles a single-segment title', () => {
    expect(getStoryKeyParts('Button/Primary')).toEqual({
      title: 'Button',
      name: 'Primary',
      componentName: 'Button',
    });
  });
});

describe('deriveBaselineSegments', () => {
  it('places the baseline beside the story source', () => {
    expect(
      deriveBaselineSegments('./src/components/Button/Button.stories.tsx', 'Foundation/Button/Variants', 'light'),
    ).toEqual(['src', 'components', 'Button', '__screenshots__', 'light', 'Button-Variants.png']);
  });

  it('separates projects into their own directories', () => {
    const [light, dark] = ['light', 'dark-desktop'].map((project) =>
      deriveBaselineSegments('./src/Foo/Foo.stories.tsx', 'Domain/Foo/Default', project),
    );

    expect(light).not.toEqual(dark);
    expect(light?.at(-2)).toBe('light');
    expect(dark?.at(-2)).toBe('dark-desktop');
  });

  it('handles an import path without the leading dot-slash', () => {
    expect(deriveBaselineSegments('src/Foo/Foo.stories.tsx', 'D/Foo/Default', 'light')).toEqual([
      'src',
      'Foo',
      '__screenshots__',
      'light',
      'Foo-Default.png',
    ]);
  });

  it('keeps two stories of the same name in different files apart', () => {
    const first = deriveBaselineSegments('./src/a/Card.stories.tsx', 'A/Card/Default', 'light');
    const second = deriveBaselineSegments('./src/b/Card.stories.tsx', 'B/Card/Default', 'light');

    expect(first).not.toEqual(second);
  });
});

describe('deriveBaselineDirectory', () => {
  it('returns the screenshots directory beside the story', () => {
    expect(deriveBaselineDirectory('./src/components/Button/Button.stories.tsx')).toBe(
      'src/components/Button/__screenshots__',
    );
  });
});
