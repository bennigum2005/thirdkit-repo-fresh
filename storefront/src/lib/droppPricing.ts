// src/lib/droppPricing.ts — server only.
// Dropp verðskrá (0–10 kg) + höfuðborgarsvæðið, verbatim from the joiweb
// production notes. ONE definition, ONE place — the site charges what this
// file says, and setDroppOnCart carries it into Magento so the ERP books the
// same number.
import "server-only";

// The 39 postcodes tagged Svæði="Höfuðborgarsvæðið" in Íslandspóstur's list
const CAPITAL_AREA_POSTCODES = new Set([
  101,102,103,104,105,107,108,109,110,111,112,113,116,121,123,124,125,127,128,129,130,132,161,162, // rvk
  170,172,             // seltjarnarnes
  200,201,202,203,     // kópavogur
  210,212,225,         // garðabær
  220,221,222,         // hafnarfjörður
  270,271,             // mosfellsbær
  276,                 // kjósarhreppur
]);

const SHIPPING_PRICES = {
  droppHomeCapital: 1410,
  droppHomeOutside: 1660,
  droppPickupCapital: 870,
  droppPickupOutside: 1075,
  storePickup: 0,
} as const;

// Pickup only. Home delivery is NEVER free. Strict >, on the subtotal AFTER
// discount. (Third Kit runs 15.000 kr. — override via env.)
function freeShippingThreshold(): number {
  const raw = Number(process.env.NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD ?? 15000);
  return isFinite(raw) && raw > 0 ? raw : 15000;
}

/** "101abc" is not 101 — reject, don't coerce (joiweb verbatim). */
export function isCapitalPostcode(pc: string | undefined | null): boolean {
  const raw = (pc ?? "").trim();
  if (!/^\d+$/.test(raw)) return false;
  return CAPITAL_AREA_POSTCODES.has(parseInt(raw, 10));
}

/** Dropp's REAL home-delivery location guid (from joi_middleware). */
export const DROPP_HOME_DELIVERY_LOCATION_ID = "9ec1f30c-2564-4b73-8954-25b7b3186ed3";

export type DroppPrices = { pickup: number; home: number; capital: boolean };

/** Region comes from the DELIVERY postcode — never billing. */
export function droppPricesFor(postcode: string, subtotalAfterDiscount: number): DroppPrices {
  const capital = isCapitalPostcode(postcode);
  const pickupBase = capital ? SHIPPING_PRICES.droppPickupCapital : SHIPPING_PRICES.droppPickupOutside;
  const home = capital ? SHIPPING_PRICES.droppHomeCapital : SHIPPING_PRICES.droppHomeOutside;
  const pickup = subtotalAfterDiscount > freeShippingThreshold() ? 0 : pickupBase;
  return { pickup, home, capital };
}
