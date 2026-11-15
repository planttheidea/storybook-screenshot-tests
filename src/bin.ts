import { runCli } from './cli.js';

const exitCode = await runCli(process.argv.slice(2));

if (exitCode !== undefined) {
  process.exitCode = exitCode;
}
