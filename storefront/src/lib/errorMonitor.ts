// src/lib/errorMonitor.ts — server only.
// Practice step 9: error monitoring. A ring buffer of recent failures with a
// tiny dashboard at /kerfi/villur. In production this swaps for Sentry (or
// similar) — captureError() is the single seam.
import "server-only";

export type CapturedError = {
  time: string;
  where: string;
  message: string;
  stack?: string;
};

const MAX = 200;
const errors: CapturedError[] = [];

export function captureError(where: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack?.split("\n").slice(0, 6).join("\n") : undefined;
  errors.unshift({ time: new Date().toISOString(), where, message, stack });
  if (errors.length > MAX) errors.pop();
  console.error(`[villa] ${where}: ${message}`);
}

export function listErrors(): CapturedError[] {
  return errors;
}
