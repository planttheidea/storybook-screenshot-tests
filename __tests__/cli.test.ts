import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serveStatic = vi.hoisted(() => vi.fn());

vi.mock('../src/serveStatic.js', () => ({ serveStatic }));

const { runCli } = await import('../src/cli.js');

let root: string;
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'screenshot-cli-'));
  writeFileSync(join(root, 'index.html'), '');
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  serveStatic.mockResolvedValue({ address: () => ({ port: 6007 }), close: vi.fn(), closeAllConnections: vi.fn() });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  serveStatic.mockReset();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('runCli', () => {
  it('serves the directory on port 6007 by default, and keeps running', async () => {
    await expect(runCli(['serve', root])).resolves.toBeUndefined();

    expect(serveStatic).toHaveBeenCalledWith({ directory: root, port: 6007, host: undefined });
    expect(log).toHaveBeenCalledWith(`Serving ${root} at http://localhost:6007`);
  });

  it('passes the port and host through', async () => {
    serveStatic.mockResolvedValue({ address: () => ({ port: 6100 }) });

    await runCli(['serve', root, '--port', '6100', '-H', '127.0.0.1']);

    expect(serveStatic).toHaveBeenCalledWith({ directory: root, port: 6100, host: '127.0.0.1' });
    expect(log).toHaveBeenCalledWith(`Serving ${root} at http://127.0.0.1:6100`);
  });

  it('closes the server and its connections on SIGTERM', async () => {
    const server = { address: () => ({ port: 6007 }), close: vi.fn(), closeAllConnections: vi.fn() };

    serveStatic.mockResolvedValue(server);

    await runCli(['serve', root]);
    process.emit('SIGTERM');

    expect(server.close).toHaveBeenCalled();
    expect(server.closeAllConnections).toHaveBeenCalled();
  });

  it('prints usage for --help', async () => {
    await expect(runCli(['--help'])).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage: storybook-screenshot-tests serve <directory>'));
  });

  it.each([
    { name: 'no command', argv: () => [] },
    { name: 'no directory', argv: () => ['serve'] },
    { name: 'an unknown command', argv: () => ['build', root] },
    { name: 'an extra argument', argv: () => ['serve', root, 'extra'] },
  ])('prints usage and fails for $name', async ({ argv }) => {
    await expect(runCli(argv())).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(serveStatic).not.toHaveBeenCalled();
  });

  it.each(['abc', '-1', '70000', '60.5'])('fails for the port %s', async (port) => {
    await expect(runCli(['serve', root, `--port=${port}`])).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith(`storybook-screenshot-tests: Not a port: ${port}`);
  });

  it('fails for an unknown option', async () => {
    await expect(runCli(['serve', root, '--open'])).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("Unknown option '--open'"));
  });

  it('reports a server that fails to start', async () => {
    serveStatic.mockRejectedValue(new Error('Port 6007 is already in use.'));

    await expect(runCli(['serve', root])).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith('storybook-screenshot-tests: Port 6007 is already in use.');
  });
});
