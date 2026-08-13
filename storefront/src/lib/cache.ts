// src/lib/cache.ts
// Cache helpers per the course: cacheKey() so two places never disagree on a
// key, cacheDel() called after every write. In-memory for now — swap these
// functions for Redis/Valkey later without touching callers.

type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

export function cacheKey(name: string, parts: Record<string, unknown>): string {
  const suffix = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${String(parts[k])}`)
    .join("&");
  return `${name}:${suffix}`;
}

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

export function cacheDel(key: string): void {
  store.delete(key);
}
