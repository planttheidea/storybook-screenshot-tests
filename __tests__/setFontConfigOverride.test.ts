import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilteredFontConfigFile } from '../src/setFontConfigOverride.js';

let root: string;
let systemDirectory: string;
let temporaryDirectory: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'screenshot-fontconfig-'));
  systemDirectory = join(root, 'conf.d');
  temporaryDirectory = join(root, 'tmp');
  mkdirSync(systemDirectory);
  mkdirSync(temporaryDirectory);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setSystemFiles(...fileNames: string[]): void {
  for (const fileName of fileNames) {
    writeFileSync(join(systemDirectory, fileName), '<fontconfig/>');
  }
}

describe('createFilteredFontConfigFile', () => {
  it('does nothing on a host without the incompatible file', async () => {
    setSystemFiles('10-hinting.conf');

    await expect(createFilteredFontConfigFile(systemDirectory, temporaryDirectory)).resolves.toBeUndefined();
    expect(readdirSync(temporaryDirectory)).toEqual([]);
  });

  it('mirrors every config file except the incompatible one', async () => {
    setSystemFiles('10-hinting.conf', '45-latin.conf', '48-guessfamily.conf', 'README');

    const configFile = await createFilteredFontConfigFile(systemDirectory, temporaryDirectory);

    expect(configFile).toBeDefined();
    expect(readdirSync(join(dirname(configFile ?? ''), 'conf.d')).sort()).toEqual(['10-hinting.conf', '45-latin.conf']);
    expect(readFileSync(configFile ?? '', 'utf-8')).toContain(
      `<include>${join(dirname(configFile ?? ''), 'conf.d')}</include>`,
    );
  });

  it('reuses a tree already built for the same set of files', async () => {
    setSystemFiles('10-hinting.conf', '48-guessfamily.conf');

    const first = await createFilteredFontConfigFile(systemDirectory, temporaryDirectory);
    const second = await createFilteredFontConfigFile(systemDirectory, temporaryDirectory);

    expect(second).toBe(first);
    expect(readdirSync(temporaryDirectory)).toHaveLength(1);
  });

  it('builds a separate tree when the set of files changes', async () => {
    setSystemFiles('10-hinting.conf', '48-guessfamily.conf');

    const first = await createFilteredFontConfigFile(systemDirectory, temporaryDirectory);

    setSystemFiles('50-user.conf');

    const second = await createFilteredFontConfigFile(systemDirectory, temporaryDirectory);

    expect(second).not.toBe(first);
    expect(existsSync(first ?? '')).toBe(true);
  });

  it('finishes a tree a concurrent run left half built', async () => {
    setSystemFiles('10-hinting.conf', '48-guessfamily.conf');

    const [first, second] = await Promise.all([
      createFilteredFontConfigFile(systemDirectory, temporaryDirectory),
      createFilteredFontConfigFile(systemDirectory, temporaryDirectory),
    ]);

    expect(second).toBe(first);
    expect(existsSync(first ?? '')).toBe(true);
  });
});
