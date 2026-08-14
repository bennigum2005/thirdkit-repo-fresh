// src/instrumentation.ts
// Next.js calls onRequestError for every uncaught server-side error — one
// hook instruments ALL routes and pages at once (practice step 9).
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  // Reserved for future setup (e.g. Sentry.init when a DSN exists)
}

export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  const { captureError } = await import("./lib/errorMonitor");
  captureError(`server ${request.method} ${request.path}`, err);
};
