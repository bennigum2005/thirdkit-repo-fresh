// src/lib/dropp.ts — server only.
// Dropp's own validation model (from their official WooCommerce plugin):
// home delivery exists ONLY for postcodes returned by
//   GET {base}/dropp/location/deliveryzips   (no auth required)
// → { codes: [{ code: "101", capital: true }, …] }, cached 10 minutes.
// A postcode outside that list simply cannot get heimsending.
import "server-only";
import { cacheGet, cacheSet } from "./cache";

const DROPP_API_BASE =
  process.env.DROPP_API_URL ?? "https://api.dropp.is/dropp/api/v1";

export type DeliveryZip = { code: string; capital: boolean };

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        // The zips endpoint is public; the key (when we get one) is only
        // needed for order creation later.
        ...(process.env.DROPP_API_KEY
          ? { Authorization: `Basic ${process.env.DROPP_API_KEY}` }
          : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`dropp HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getDeliveryZips(): Promise<DeliveryZip[]> {
  const CACHE = "dropp:deliveryzips";
  const cached = cacheGet<DeliveryZip[]>(CACHE);
  if (cached) return cached;

  const raw = (await fetchJson(`${DROPP_API_BASE}/dropp/location/deliveryzips`)) as {
    codes?: Array<{ code?: unknown; capital?: unknown }>;
  };
  const zips: DeliveryZip[] = (raw.codes ?? [])
    .map((c) => ({ code: String(c.code ?? ""), capital: Boolean(c.capital) }))
    .filter((c) => c.code);

  if (zips.length) cacheSet(CACHE, zips, 10 * 60); // same 10-min TTL as Dropp's plugin
  return zips;
}

/**
 * Can Dropp home-deliver to this postcode?
 * known=false means Dropp's API was unreachable — the caller decides whether
 * to fail open (we do: never block a sale on a third-party outage).
 */
export async function homeDeliveryAvailable(
  postcode: string
): Promise<{ available: boolean; known: boolean }> {
  try {
    const zips = await getDeliveryZips();
    if (!zips.length) return { available: true, known: false };
    const pc = postcode.trim();
    return { available: zips.some((z) => z.code === pc), known: true };
  } catch (err) {
    console.error("dropp deliveryzips:", err instanceof Error ? err.message : err);
    return { available: true, known: false };
  }
}
