"use client";
// Browser-side leg of step 9: uncaught errors and rejected promises in the
// customer's browser report themselves to /api/log-error.
import { useEffect } from "react";

export function ErrorReporter() {
  useEffect(() => {
    const report = (message: string, source: string) => {
      try {
        navigator.sendBeacon?.(
          "/api/log-error",
          new Blob([JSON.stringify({ message, source })], { type: "application/json" })
        ) ||
          fetch("/api/log-error", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, source }),
            keepalive: true,
          }).catch(() => {});
      } catch {}
    };

    const onError = (e: ErrorEvent) => report(e.message, `${e.filename}:${e.lineno}`);
    const onRejection = (e: PromiseRejectionEvent) =>
      report(e.reason instanceof Error ? e.reason.message : String(e.reason), "unhandledrejection");

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
