// src/lib/addressRegistry.ts — server only.
// Validates that an Icelandic address actually EXISTS, using Staðfangaskrá —
// the official national address registry from HMS, published as open data and
// refreshed weekly. We load it once into memory (postcode → street → house
// numbers) and answer lookups instantly. If the registry can't be fetched we
// fail OPEN: an outage at HMS must never block a sale.
import "server-only";

const STADFANGASKRA_URL =
  process.env.STADFANGASKRA_URL ??
  "https://hmsstgsftpprodweu001.blob.core.windows.net/fasteignaskra/Stadfangaskra.csv";

const REFRESH_MS = 24 * 60 * 60 * 1000; // registry updates weekly; daily is plenty

/** postcode → normalized street/place name → set of house numbers ("" = no number, e.g. farms) */
type Index = Map<string, Map<string, Set<string>>>;

/** Forgiving normalization: „Laugavegi", „laugavegur" og „LAUGAVEGUR" match. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ð/g, "d")
    .replace(/þ/g, "th")
    .replace(/æ/g, "ae")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal CSV line splitter that respects quoted fields. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

let index: Index | null = null;
let loadedAt = 0;
let loading: Promise<Index | null> | null = null;

async function buildIndex(): Promise<Index | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000); // big file
  try {
    const res = await fetch(STADFANGASKRA_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`stadfangaskra HTTP ${res.status}`);
    const text = await res.text();

    const lines = text.split(/\r?\n/);
    if (lines.length < 2) throw new Error("stadfangaskra: empty file");

    // Column positions from the header — never by fixed index.
    const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
    const header = splitCsvLine(lines[0], delim).map((h) => h.trim().toUpperCase());
    const col = (name: string) => header.findIndex((h) => h === name);
    const cPost = col("POSTNR");
    const cNf = col("HEITI_NF");   // street, nominative (Laugavegur)
    const cTgf = col("HEITI_TGF"); // street, dative (Laugavegi)
    const cNr = col("HUSNR");
    const cSer = col("SERHEITI");  // named places/farms without street numbers
    if (cPost < 0 || (cNf < 0 && cTgf < 0)) throw new Error("stadfangaskra: unexpected header " + header.slice(0, 12).join(","));

    const idx: Index = new Map();
    const add = (postcode: string, name: string, husnr: string) => {
      if (!name) return;
      let streets = idx.get(postcode);
      if (!streets) { streets = new Map(); idx.set(postcode, streets); }
      const key = norm(name);
      let numbers = streets.get(key);
      if (!numbers) { numbers = new Set(); streets.set(key, numbers); }
      numbers.add(husnr);
    };

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const f = splitCsvLine(lines[i], delim);
      const postcode = (f[cPost] ?? "").trim();
      if (!/^\d{3}$/.test(postcode)) continue;
      const husnr = (cNr >= 0 ? (f[cNr] ?? "") : "").trim();
      if (cNf >= 0) add(postcode, (f[cNf] ?? "").trim(), husnr);
      if (cTgf >= 0) add(postcode, (f[cTgf] ?? "").trim(), husnr);
      if (cSer >= 0) add(postcode, (f[cSer] ?? "").trim(), husnr);
    }
    if (!idx.size) throw new Error("stadfangaskra: parsed 0 addresses");
    console.log(`Staðfangaskrá: ${idx.size} póstnúmer í minni`);
    return idx;
  } finally {
    clearTimeout(timer);
  }
}

/** Load (or reuse) the registry. Null = unavailable right now. */
export async function getRegistry(): Promise<Index | null> {
  if (index && Date.now() - loadedAt < REFRESH_MS) return index;
  if (!loading) {
    loading = buildIndex()
      .then((idx) => {
        if (idx) { index = idx; loadedAt = Date.now(); }
        return idx;
      })
      .catch((err) => {
        console.error("stadfangaskra:", err instanceof Error ? err.message : err);
        return index; // keep serving a stale copy if we ever had one
      })
      .finally(() => { loading = null; });
  }
  return loading;
}

export type AddressCheck =
  | { known: false }                                  // registry unavailable — fail open
  | { known: true; ok: true }
  | { known: true; ok: false; reason: "STREET" | "NUMBER" };

/**
 * Does "Laugavegur 26" exist in postcode 101?
 * Street part = everything before the first digit; number = first integer.
 * Addresses without numbers (farms, named places) pass on the name alone.
 */
export async function checkAddress(address: string, postcode: string): Promise<AddressCheck> {
  const registry = await getRegistry();
  const streets = registry?.get(postcode.trim());
  if (!registry || !streets) return { known: false };

  const raw = address.trim();
  const numMatch = raw.match(/\d+/);
  const streetPart = norm(numMatch ? raw.slice(0, numMatch.index) : raw).replace(/[,.]+$/, "").trim();
  if (!streetPart) return { known: true, ok: false, reason: "STREET" };

  const numbers = streets.get(streetPart);
  if (!numbers) return { known: true, ok: false, reason: "STREET" };
  if (!numMatch) {
    // No house number typed — fine if this name exists without numbers (farms)
    return numbers.has("") ? { known: true, ok: true } : { known: true, ok: false, reason: "NUMBER" };
  }
  return numbers.has(numMatch[0]) ? { known: true, ok: true } : { known: true, ok: false, reason: "NUMBER" };
}
