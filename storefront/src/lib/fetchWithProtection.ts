// src/lib/fetchWithProtection.ts
// A fetch wrapper with a timeout, one retry and a circuit breaker (course ch. 8).
// Used by the Magento client so no request can hang the page for 30 seconds.

const TIMEOUT_MS = 8_000;
const RETRIES = 1;

// Circuit breaker state (per server process)
const FAILURE_THRESHOLD = 5;
const OPEN_MS = 30_000;
let failures = 0;
let openedAt = 0;

function breakerOpen(): boolean {
  if (failures < FAILURE_THRESHOLD) return false;
  if (Date.now() - openedAt > OPEN_MS) {
    // half-open: allow one attempt through
    failures = FAILURE_THRESHOLD - 1;
    return false;
  }
  return true;
}

export const fetchWithProtection: typeof fetch = async (input, init) => {
  if (breakerOpen()) {
    throw new Error("Magento circuit breaker is open — failing fast");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.status >= 500) throw new Error(`Magento responded ${res.status}`);
      failures = 0;
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      failures++;
      if (failures >= FAILURE_THRESHOLD) openedAt = Date.now();
    }
  }
  throw lastError;
};
