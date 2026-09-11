import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineScreenshotConfig } from '../src/defineScreenshotConfig.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'screenshot-config-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function createConfig(overrides = {}) {
  return defineScreenshotConfig({
    rootDir: root,
    storybookCommand: 'start-storybook',
    projects: [{ name: 'light' }],
    ...overrides,
  });
}

/** The first project's `use`, narrowed so the assertions read cleanly. */
function getFirstProjectUse(overrides = {}): Record<string, any> {
  const project = createConfig(overrides).projects?.[0];

  expect(project).toBeDefined();

  return project?.use as Record<string, any>;
}

describe('defineScreenshotConfig webServer', () => {
  it('shuts the server down gracefully by default', () => {
    expect(createConfig().webServer).toMatchObject({
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    });
  });

  it('lets the caller override the shutdown signal and timeout', () => {
    expect(
      createConfig({
        storybookServer: { gracefulShutdown: { signal: 'SIGINT', timeout: 100 } },
      }).webServer,
    ).toMatchObject({ gracefulShutdown: { signal: 'SIGINT', timeout: 100 } });
  });

  it('merges server overrides without dropping the generated fields', () => {
    const { webServer } = createConfig({ storybookServer: { env: { NX_DAEMON: 'false' } } });

    expect(webServer).toMatchObject({
      command: 'start-storybook',
      env: { NX_DAEMON: 'false' },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    });
  });

  it('runs an nx storybook in-process so it stays killable', () => {
    expect(createConfig({ nx: true }).webServer).toMatchObject({
      env: { NX_DAEMON: 'false', NX_TUI: 'false' },
    });
  });

  it('sets no environment when nx is not in play', () => {
    expect(createConfig().webServer).not.toHaveProperty('env');
  });

  it('lets explicit environment entries win over the nx defaults', () => {
    expect(
      createConfig({ nx: true, storybookServer: { env: { NX_TUI: 'true', PORT: '7007' } } }).webServer,
    ).toMatchObject({ env: { NX_DAEMON: 'false', NX_TUI: 'true', PORT: '7007' } });
  });

  it('keeps the nx environment when other server overrides are also given', () => {
    expect(createConfig({ nx: true, storybookServer: { timeout: 60_000 } }).webServer).toMatchObject({
      timeout: 60_000,
      env: { NX_DAEMON: 'false', NX_TUI: 'false' },
    });
  });

  it('omits the server entirely when no command is given', () => {
    expect(createConfig({ storybookCommand: undefined }).webServer).toBeUndefined();
  });
});

describe('defineScreenshotConfig projects', () => {
  it('spreads the device descriptor and applies the globals fixture', () => {
    const use = getFirstProjectUse({
      projects: [
        {
          name: 'dark',
          device: { viewport: { width: 400, height: 800 }, isMobile: true },
          colorScheme: 'dark',
          globals: { theme: 'dark' },
        },
      ],
    });

    expect(use).toMatchObject({
      viewport: { width: 400, height: 800 },
      isMobile: true,
      colorScheme: 'dark',
      storybookGlobals: { theme: 'dark' },
    });
  });

  it('lets an explicit viewport win over the device descriptor', () => {
    const use = getFirstProjectUse({
      projects: [
        {
          name: 'desktop',
          device: { viewport: { width: 400, height: 800 } },
          viewport: { width: 1280, height: 800 },
        },
      ],
    });

    expect(use.viewport).toEqual({ width: 1280, height: 800 });
  });

  it('defaults globals to an empty object for apps that do not use them', () => {
    expect(getFirstProjectUse().storybookGlobals).toEqual({});
  });
});

describe('defineScreenshotConfig snapshots', () => {
  it('resolves baselines against the config directory, not the test directory', () => {
    expect(createConfig().snapshotPathTemplate).toBe('{arg}{ext}');
  });
});
