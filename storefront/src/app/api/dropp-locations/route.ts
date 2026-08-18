// src/app/api/dropp-locations/route.ts
// Server-side proxy for Dropp's public pickup-location list, so the checkout
// can offer address SEARCH instead of the map widget. The browser never talks
// to Dropp directly (CORS + keeps the URL swappable via env).
import { cacheGet, cacheSet } from "@/lib/cache";

const DROPP_LOCATIONS_URL =
  process.env.DROPP_LOCATIONS_URL ??
  "https://api.dropp.is/dropp/api/v1/dropp/locations";

type SlimLocation = { id: string; name: string; address: string; lat?: number; lng?: number };

/** Dropp's payload shape has varied — read it defensively. */
function slim(raw: unknown): SlimLocation[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { locations?: unknown[] })?.locations)
      ? (raw as { locations: unknown[] }).locations
      : Array.isArray((raw as { data?: unknown[] })?.data)
        ? (raw as { data: unknown[] }).data
        : [];

  const out: SlimLocation[] = [];
  for (const item of list) {
    const loc = item as Record<string, unknown>;
    const id = String(loc.id ?? loc.barcode ?? loc.storeId ?? "");
    const name = String(loc.name ?? loc.title ?? "");
    if (!id || !name) continue;

    let address = "";
    const a = loc.address;
    if (typeof a === "string") address = a;
    else if (a && typeof a === "object") {
      const ao = a as Record<string, unknown>;
      address = [ao.street ?? ao.address1 ?? "", ao.postcode ?? ao.zip ?? "", ao.town ?? ao.city ?? ""]
        .map((p) => String(p ?? "").trim())
        .filter(Boolean)
        .join(", ");
    } else {
      address = [loc.street, loc.postcode ?? loc.zip, loc.town ?? loc.city]
        .map((p) => String(p ?? "").trim())
        .filter(Boolean)
        .join(", ");
    }
    const lat = Number(loc.gpsLatitude ?? loc.latitude ?? loc.lat);
    const lng = Number(loc.gpsLongitude ?? loc.longitude ?? loc.lng);
    out.push({
      id, name, address,
      ...(isFinite(lat) && isFinite(lng) && lat !== 0 ? { lat, lng } : {}),
    });
  }
  return out;
}

export async function GET() {
  try {
    const CACHE = "dropp:locations";
    let locations = cacheGet<SlimLocation[]>(CACHE);
    if (!locations) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(DROPP_LOCATIONS_URL, {
          headers: {
            Accept: "application/json",
            // Bearer is fine for READING locations (never for booking — that's
            // Basic storeId:password, and it happens in fulfilment, not here).
            ...(process.env.DROPP_API_TOKEN
              ? { Authorization: `Bearer ${process.env.DROPP_API_TOKEN}` }
              : {}),
          },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`dropp locations HTTP ${res.status}`);
        locations = slim(await res.json());
      } finally {
        clearTimeout(timer);
      }
      if (locations.length) cacheSet(CACHE, locations, 3600); // locations change ~monthly
    }

    if (!locations.length) {
      return Response.json({ error: "NO_LOCATIONS" }, { status: 502 });
    }
    return Response.json({ locations });
  } catch (err) {
    console.error("dropp-locations:", err instanceof Error ? err.message : err);
    return Response.json({ error: "DROPP_UNAVAILABLE" }, { status: 502 });
  }
}
