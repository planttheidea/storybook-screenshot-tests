import { describe, expect, it } from 'vitest';
import { getRenderPhaseDescription, getStoryErrorHint, getStoryErrorMessage } from '../src/waitForStoryRender.js';

describe('getStoryErrorMessage', () => {
  it('prefers the stack of a serialized exception, which opens with its message', () => {
    expect(
      getStoryErrorMessage({
        name: 'TypeError',
        message: 'x is undefined',
        stack: 'TypeError: x is undefined\n  at X',
      }),
    ).toBe('TypeError: x is undefined\n  at X');
  });

  it('falls back to the message when there is no stack', () => {
    expect(getStoryErrorMessage({ name: 'Error', message: 'boom' })).toBe('boom');
  });

  it('joins the title and description of a render error', () => {
    expect(getStoryErrorMessage({ title: 'No render', description: 'Add a render function' })).toBe(
      'No render: Add a render function',
    );
  });

  it('accepts a render error with only one of title and description', () => {
    expect(getStoryErrorMessage({ description: 'Add a render function' })).toBe('Add a render function');
  });

  it('passes a string payload, such as a missing story id, through', () => {
    expect(getStoryErrorMessage('components-foo--bar')).toBe('components-foo--bar');
  });

  it('formats each entry of a list of errors on its own line', () => {
    expect(getStoryErrorMessage([{ message: 'first' }, 'second'])).toBe('first\nsecond');
  });

  it('describes an unsuccessful finish by its status', () => {
    expect(getStoryErrorMessage({ status: 'error', storyId: 'foo' })).toBe('the story finished with status "error"');
  });

  it('falls back to json for a shape it does not know', () => {
    expect(getStoryErrorMessage({ code: 42 })).toBe('{"code":42}');
  });

  it('says so when there is no payload at all', () => {
    expect(getStoryErrorMessage(null)).toBe('no details were given');
    expect(getStoryErrorMessage(undefined)).toBe('no details were given');
  });

  it('never stringifies an object to [object Object]', () => {
    expect(getStoryErrorMessage({ nested: { value: true } })).not.toContain('[object Object]');
  });
});

describe('getRenderPhaseDescription', () => {
  it('names the last phase the story reported', () => {
    expect(getRenderPhaseDescription('rendering')).toBe('last render phase: rendering');
  });

  it('says the preview never started when no phase was reported', () => {
    expect(getRenderPhaseDescription(undefined)).toBe('the preview never started rendering');
  });

  it('says the page could not be read when reading it failed', () => {
    expect(getRenderPhaseDescription(null)).toBe('the page could not be read');
  });
});

describe('getStoryErrorHint', () => {
  it('explains that a missing story may be a failed import', () => {
    expect(getStoryErrorHint('storyMissing')).toMatch(/failed to import[\s\S]*debug: true/);
  });

  it('adds nothing for events whose payload explains itself', () => {
    expect(getStoryErrorHint('storyThrewException')).toBeUndefined();
  });
});
