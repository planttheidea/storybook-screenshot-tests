import { afterEach, describe, expect, it } from 'vitest';
import { resolveOptions } from '../src/options.js';

const projects = [{ name: 'light' }];

afterEach(() => {
  delete process.env.STORYBOOK_URL;
});

describe('resolveOptions', () => {
  it('applies the default storybook url, generated directory, and tags', () => {
    const resolved = resolveOptions({ projects }, '/app');

    expect(resolved.storybookUrl).toBe('http://localhost:6006');
    expect(resolved.generatedDir).toBe('__generated__/screenshots');
    expect(resolved.tags).toEqual({
      screenshot: 'screenshot',
      failing: 'screenshot:failing',
      disabled: 'screenshot:disabled',
      domainPrefix: 'domain:',
    });
  });

  it('prefers an explicit url over the environment', () => {
    process.env.STORYBOOK_URL = 'http://localhost:7007';

    expect(resolveOptions({ projects, storybookUrl: 'http://explicit' }, '/app').storybookUrl).toBe('http://explicit');
  });

  it('falls back to the environment url', () => {
    process.env.STORYBOOK_URL = 'http://localhost:7007';

    expect(resolveOptions({ projects }, '/app').storybookUrl).toBe('http://localhost:7007');
  });

  it('merges partial tag overrides over the defaults', () => {
    const { tags } = resolveOptions({ projects, tags: { screenshot: 'visual' } }, '/app');

    expect(tags.screenshot).toBe('visual');
    expect(tags.failing).toBe('screenshot:failing');
  });

  it('rejects a project whose targeting tag would be a reserved tag', () => {
    expect(() => resolveOptions({ projects: [{ name: 'failing' }] }, '/app')).toThrow(/Project "failing"/);
    expect(() => resolveOptions({ projects: [{ name: 'disabled' }] }, '/app')).toThrow(/Project "disabled"/);
    expect(() =>
      resolveOptions({ projects: [{ name: 'failing' }], tags: { failing: 'screenshot:broken' } }, '/app'),
    ).not.toThrow();
  });

  it('normalizes a fixed time to an iso string so the result is json-safe', () => {
    const resolved = resolveOptions({ projects, fixedTime: new Date('2026-07-15T12:00:00.000Z') }, '/app');

    expect(resolved.fixedTime).toBe('2026-07-15T12:00:00.000Z');

    const parsedResolved = JSON.parse(JSON.stringify(resolved)) as Record<string, any>;

    expect(parsedResolved.fixedTime).toBe('2026-07-15T12:00:00.000Z');
  });

  it('leaves an already-serialized fixed time alone', () => {
    expect(resolveOptions({ projects, fixedTime: '2026-07-15T12:00:00.000Z' }, '/app').fixedTime).toBe(
      '2026-07-15T12:00:00.000Z',
    );
  });

  it('records the root directory it was given', () => {
    expect(resolveOptions({ projects }, '/somewhere/app').rootDir).toBe('/somewhere/app');
  });
});

describe('resolveOptions server overrides', () => {
  it('defaults to no server overrides', () => {
    expect(resolveOptions({ projects }, '/app').storybookServer).toEqual({});
  });

  it('carries server overrides through, json-safe', () => {
    const resolved = resolveOptions(
      {
        projects,
        storybookServer: {
          env: { NX_DAEMON: 'false' },
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
        },
      },
      '/app',
    );

    const parsedResolved = JSON.parse(JSON.stringify(resolved)) as Record<string, any>;

    expect(parsedResolved.storybookServer).toEqual({
      env: { NX_DAEMON: 'false' },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    });
  });
});

describe('resolveOptions full-rerun paths', () => {
  it('defaults to nothing when the caller supplies no paths', () => {
    expect(resolveOptions({ projects }, '/app').affected.fullRerunPaths).toEqual([]);
  });

  it('carries the shared defaults through', () => {
    const resolved = resolveOptions({ projects }, '/app', ['apps/web/screenshots.config.ts', 'apps/web/.storybook']);

    expect(resolved.affected.fullRerunPaths).toEqual(['apps/web/screenshots.config.ts', 'apps/web/.storybook']);
  });

  it('appends the project own paths after the defaults', () => {
    const resolved = resolveOptions({ projects, affected: { fullRerunPaths: ['apps/web/src/styles'] } }, '/app', [
      'apps/web/.storybook',
    ]);

    expect(resolved.affected.fullRerunPaths).toEqual(['apps/web/.storybook', 'apps/web/src/styles']);
  });

  it('deduplicates a path the project also declared', () => {
    const resolved = resolveOptions({ projects, affected: { fullRerunPaths: ['apps/web/.storybook'] } }, '/app', [
      'apps/web/.storybook',
    ]);

    expect(resolved.affected.fullRerunPaths).toEqual(['apps/web/.storybook']);
  });

  it('preserves the rest of the affected options', () => {
    const resolved = resolveOptions({ projects, affected: { baseRef: 'main' } }, '/app', ['a.ts']);

    expect(resolved.affected.baseRef).toBe('main');
  });
});
