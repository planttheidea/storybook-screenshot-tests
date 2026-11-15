import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serveStatic } from '../src/serveStatic.js';

let parent: string;
let root: string;
let server: Server | undefined;

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'screenshot-serve-'));
  root = join(parent, 'storybook-static');

  mkdirSync(join(root, 'assets', 'with space'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<html>manager</html>');
  writeFileSync(join(root, 'iframe.html'), '<html>preview</html>');
  writeFileSync(join(root, 'index.json'), '{"v":5,"entries":{}}');
  writeFileSync(join(root, 'assets', 'app.js'), 'export {};');
  writeFileSync(join(root, 'assets', 'engine.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(join(root, 'assets', 'data.bin'), 'binary');
  writeFileSync(join(root, 'assets', 'with space', 'file.css'), 'body {}');
  writeFileSync(join(parent, 'secret.txt'), 'outside the root');
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  }

  rmSync(parent, { recursive: true, force: true });
});

async function start(): Promise<number> {
  server = await serveStatic({ directory: root, port: 0, host: '127.0.0.1' });

  return (server.address() as AddressInfo).port;
}

/** `fetch` normalizes `..` out of a URL before sending it, so traversal needs a raw request. */
function rawRequest(port: number, path: string, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method }, (response) => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body });
      });
    });

    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('serveStatic', () => {
  it('serves the files Storybook needs for a run', async () => {
    const port = await start();
    const index = await fetch(`http://127.0.0.1:${port}/index.json`);
    const iframe = await fetch(`http://127.0.0.1:${port}/iframe.html?id=a--b&viewMode=story`);

    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await index.json()).toEqual({ v: 5, entries: {} });
    expect(iframe.status).toBe(200);
    expect(await iframe.text()).toBe('<html>preview</html>');
  });

  it('answers a directory with its index.html', async () => {
    const port = await start();
    const response = await fetch(`http://127.0.0.1:${port}/`);

    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<html>manager</html>');
  });

  it('sends the types browsers enforce, and a fallback for the rest', async () => {
    const port = await start();
    const types = await Promise.all(
      ['assets/app.js', 'assets/engine.wasm', 'assets/with%20space/file.css', 'assets/data.bin'].map(async (path) => {
        const response = await fetch(`http://127.0.0.1:${port}/${path}`);

        return response.headers.get('content-type');
      }),
    );

    expect(types).toEqual([
      'text/javascript; charset=utf-8',
      'application/wasm',
      'text/css; charset=utf-8',
      'application/octet-stream',
    ]);
  });

  it('never lets a browser cache a build', async () => {
    const port = await start();
    const response = await fetch(`http://127.0.0.1:${port}/index.json`);

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a missing file with a 404', async () => {
    const port = await start();
    const response = await fetch(`http://127.0.0.1:${port}/missing.js`);

    expect(response.status).toBe(404);
  });

  it('refuses a path that leaves the root', async () => {
    const port = await start();

    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const response = await rawRequest(port, path);

      expect(response.status).toBe(404);
      expect(response.body).not.toContain('outside the root');
    }
  });

  it('refuses a path that cannot be decoded', async () => {
    const port = await start();
    const response = await rawRequest(port, '/%E0%A4%A');

    expect(response.status).toBe(404);
  });

  it('answers HEAD with headers and no body', async () => {
    const port = await start();
    const response = await rawRequest(port, '/index.json', 'HEAD');

    expect(response.status).toBe(200);
    expect(response.headers['content-length']).toBe('20');
    expect(response.body).toBe('');
  });

  it('refuses methods other than GET and HEAD', async () => {
    const port = await start();
    const response = await rawRequest(port, '/index.json', 'POST');

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET, HEAD');
  });

  it('rejects a directory that does not exist', async () => {
    await expect(serveStatic({ directory: join(parent, 'missing'), port: 0 })).rejects.toThrow(
      /is not a directory\. Build Storybook first\./,
    );
  });

  it('rejects a port that is already in use rather than moving', async () => {
    const port = await start();

    await expect(serveStatic({ directory: root, port, host: '127.0.0.1' })).rejects.toThrow(
      `Port ${port} is already in use.`,
    );
  });
});
