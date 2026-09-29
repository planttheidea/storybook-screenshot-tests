import color from 'picocolors';

export type DebugLogger = (message: string) => void;

/**
 * Logs to stdout only when `debug` is set, prefixed so it stands apart from the
 * reporter. In a test worker, stdout reaches the reporter as the test's output,
 * which prints it alongside that test's failure.
 */
export function createDebugLogger(enabled: boolean): DebugLogger {
  return enabled ? logDebug : ignoreDebug;
}

function logDebug(message: string): void {
  console.log(color.gray(`[screenshots] ${message}`));
}

function ignoreDebug(): void {
  // Debugging is off.
}
