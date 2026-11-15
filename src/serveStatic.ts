import type { Stats } from 'node:fs';
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

export interface ServeStaticOptions {
  /** Directory to serve, usually Storybook's build output. */
  directory: string;
  /** Port to listen on. `0` picks a free one. */
  port: number;
  /** Interface to bind. Omitted, every interface, IPv4 and IPv6 alike. */
  host?: string;
}

/**
 * Covers what a Storybook build emits, plus the assets stories commonly import.
 * Anything else goes out as `application/octet-stream`, which a browser still
 * accepts for a fetch — only scripts, styles, and wasm are refused on a wrong type.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serves a directory over HTTP, resolving once it is listening.
 *
 * Built for one job: answering a screenshot run from a static Storybook build.
 * Every response is `no-store`, so a browser never holds on to a previous
 * build, and a port already in use rejects rather than moving to another one —
 * the run is pointed at one URL, and a server anywhere else would never answer it.
 */
export function serveStatic({ directory, port, host }: ServeStaticOptions): Promise<Server> {
  const root = resolve(directory);
  const rootStats = getStats(root);

  if (!rootStats?.isDirectory()) {
    return Promise.reject(new Error(`Nothing to serve: ${root} is not a directory. Build Storybook first.`));
  }

  const server = createServer((request, response) => {
    handleRequest(root, request, response);
  });

  return new Promise((resolvePromise, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use. Stop whatever is listening there, or choose another port.`)
          : error,
      );
    };

    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolvePromise(server);
    });
  });
}

function handleRequest(root: string, request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, { Allow: 'GET, HEAD' });
    return;
  }

  const filePath = resolveFilePath(root, request.url ?? '/');
  const stats = filePath ? getStats(filePath) : undefined;

  if (!filePath || !stats?.isFile()) {
    send(response, 404);
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': stats.size,
    'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath)
    .on('error', () => response.destroy())
    .pipe(response);
}

/**
 * Maps a request URL to a file under the root, or `undefined` for one that
 * cannot be decoded or would land outside it. A directory resolves to its
 * `index.html`, which is how `/` reaches the manager page.
 */
function resolveFilePath(root: string, url: string): string | undefined {
  let pathname: string;

  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return undefined;
  }

  // A decoded NUL is never a real file name, and some file systems reject it outright.
  if (pathname.includes('\0')) {
    return undefined;
  }

  const filePath = resolve(join(root, pathname));

  if (filePath !== root && !filePath.startsWith(root + sep)) {
    return undefined;
  }

  return getStats(filePath)?.isDirectory() ? join(filePath, 'index.html') : filePath;
}

function getStats(path: string): Stats | undefined {
  return statSync(path, { throwIfNoEntry: false });
}

function send(response: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  response.end(status === 404 ? 'Not found' : 'Method not allowed');
}
