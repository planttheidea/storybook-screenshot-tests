import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebugLogger } from '../src/debugLogger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDebugLogger', () => {
  it('logs with the library prefix when enabled', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    createDebugLogger(true)('[timing] rendered');

    expect(stripVTControlCharacters(String(log.mock.calls[0]?.[0]))).toBe('[screenshots] [timing] rendered');
  });

  it('stays silent when disabled', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    createDebugLogger(false)('[timing] rendered');

    expect(log).not.toHaveBeenCalled();
  });
});
