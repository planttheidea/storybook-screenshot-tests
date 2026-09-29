import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearManifestCache, getManifest, getStoryIndex, setManifest } from '../src/manifest.js';
import { GENERATED_DIR_VARIABLE, getResolvedOptions } from '../src/paths.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'screenshot-manifest-'));
  process.env[GENERATED_DIR_VARIABLE] = root;
  clearManifestCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  Reflect.deleteProperty(process.env, GENERATED_DIR_VARIABLE);
  clearManifestCache();
  vi.unstubAllGlobals();
});

describe('getManifest', () => {
  it('returns an empty manifest when global setup has not written one', () => {
    expect(getManifest()).toEqual({ stories: [], allImportPaths: [], capturedCount: 0, totalCount: 0 });
  });

  it('reads the manifest global setup wrote', () => {
    const manifest = { stories: [], allImportPaths: ['./a.stories.tsx'], capturedCount: 0, totalCount: 2 };

    setManifest(manifest);

    expect(getManifest()).toEqual(manifest);
  });

  it('caches the first read for the life of the process', () => {
    const first = getManifest();

    setManifest({ stories: [], allImportPaths: ['./late.stories.tsx'], capturedCount: 0, totalCount: 1 });

    expect(getManifest()).toBe(first);
  });
});

describe('getStoryIndex', () => {
  it('returns the parsed index', async () => {
    const index = { v: 5, entries: {} };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(index))));

    await expect(getStoryIndex('http://localhost:6006')).resolves.toEqual(index);
  });

  it('names the url and the fix when storybook cannot be reached', async () => {
    const error = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));

    await expect(getStoryIndex('http://localhost:6006')).rejects.toThrow(
      /Could not reach Storybook at http:\/\/localhost:6006 \(ECONNREFUSED\).*storybookCommand/,
    );
  });

  it('reports the status of an unsuccessful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' })));

    await expect(getStoryIndex('http://localhost:6006')).rejects.toThrow(/index\.json: 404 Not Found/);
  });

  it('says so when the response is not json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>')));

    await expect(getStoryIndex('http://localhost:6006')).rejects.toThrow(/is not JSON/);
  });
});

describe('getResolvedOptions', () => {
  it('reads the options written at config load', () => {
    writeFileSync(join(root, 'options.json'), JSON.stringify({ debug: true }));

    expect(getResolvedOptions()).toEqual({ debug: true });
  });

  it('points at defineScreenshotConfig when the options file is missing', () => {
    expect(() => getResolvedOptions()).toThrow(/defineScreenshotConfig\(\)/);
  });
});
