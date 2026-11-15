import { parseArgs } from 'node:util';
import { serveStatic } from './serveStatic.js';

const COMMAND = 'storybook-screenshot-tests';

const USAGE = `Usage: ${COMMAND} serve <directory> [--port <port>] [--host <host>]

Serves a static Storybook build for a screenshot run.

Options:
  -p, --port   Port to listen on (default: 6007). Fails if it is in use.
  -H, --host   Interface to bind (default: every interface).
  -h, --help   Show this message.`;

/**
 * Runs the command line, returning the exit code for a run that is finished.
 * A server that is listening never returns: it runs until a signal stops it.
 */
export async function runCli(argv: string[]): Promise<number | undefined> {
  let parsed: ReturnType<typeof parse>;

  try {
    parsed = parse(argv);
  } catch (error) {
    return fail(error);
  }

  const { positionals, values } = parsed;

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const [command, directory, ...rest] = positionals;

  if (command !== 'serve' || !directory || rest.length > 0) {
    console.error(USAGE);
    return 1;
  }

  const port = Number(values.port);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    return fail(new Error(`Not a port: ${values.port}`));
  }

  try {
    const server = await serveStatic({ directory, port, host: values.host });
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;

    console.log(`Serving ${directory} at http://${values.host ?? 'localhost'}:${boundPort}`);

    // Playwright asks with SIGTERM before it kills the group. Closing open
    // connections too, or a kept-alive browser socket holds the exit open.
    const stop = () => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    };

    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);

    return undefined;
  } catch (error) {
    return fail(error);
  }
}

function parse(argv: string[]) {
  return parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      help: { short: 'h', type: 'boolean' },
      host: { short: 'H', type: 'string' },
      port: { default: '6007', short: 'p', type: 'string' },
    },
  });
}

function fail(error: unknown): number {
  console.error(`${COMMAND}: ${error instanceof Error ? error.message : String(error)}`);
  return 1;
}
