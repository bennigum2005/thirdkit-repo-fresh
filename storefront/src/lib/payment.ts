// src/lib/payment.ts — server only.
// Payment machinery per course ch. 7. The provider behind createSession() is
// swappable: today a built-in sandbox page; later Valitor/other — the four
// rules stay identical either way:
//   1 · the server computes the amount from the Magento cart
//   2 · the WEBHOOK creates the order, never the browser
//   3 · the webhook is idempotent (event-id dedupe + per-cart lock)
//   4 · the webhook signature is always verified
import "server-only";
import crypto from "crypto";
import { cacheGet, cacheSet } from "./cache";

function secret(): string {
  const s = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!s) {
    console.warn("PAYMENT_WEBHOOK_SECRET not set — using dev-only default");
    return "dev-only-secret-change-me";
  }
  return s;
}

export function signPayload(rawBody: string): string {
  return crypto.createHmac("sha256", secret()).update(rawBody, "utf8").digest("hex");
}

export function verifySignature(rawBody: string, signature: string): boolean {
  const expected = signPayload(rawBody);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Snapshot + reverse map (joiweb lesson: 1h TTL lost orders when someone left
// the payment page open — money taken, snapshot gone. We use 24h.)

const SNAPSHOT_TTL = 24 * 3600;

export type PaymentSnapshot = { cartId: string; amount: number; currency: string };

export function saveSnapshot(ref: string, snap: PaymentSnapshot): void {
  cacheSet(`verifone:form:${ref}`, snap, SNAPSHOT_TTL);
}

export function getSnapshot(ref: string): PaymentSnapshot | undefined {
  return cacheGet<PaymentSnapshot>(`verifone:form:${ref}`);
}

/** merchant_reference can just be MISSING in the webhook payload — store a
 *  reverse map by checkout id when the session is created (joiweb verbatim). */
export function mapCheckoutId(checkoutId: string, ref: string): void {
  if (checkoutId) cacheSet(`verifone:map:checkout:${checkoutId}`, ref, SNAPSHOT_TTL);
}

export function refForCheckoutId(checkoutId: string): string | undefined {
  return cacheGet<string>(`verifone:map:checkout:${checkoutId}`);
}

// ---------------------------------------------------------------------------
// In-memory state — fine for a single dev server. Production swaps this for
// Redis/Valkey (same shape) so retries and multiple instances stay safe.

export type OrderResult = {
  status: "pending" | "placed" | "failed" | "payment_failed";
  orderNumber?: string;
};

const orderResults = new Map<string, OrderResult>();

/** Dupe-delivery guard: providers retry. 1h window (joiweb). */
export function seenEvent(eventId: string): boolean {
  const key = `verifone:event:${eventId}`;
  if (cacheGet(key)) return true;
  cacheSet(key, true, 3600);
  return false;
}

/** Single-flight around order creation — 120s TTL so a crashed worker never
 *  wedges the reference forever (joiweb: valkeySetNX ttl 120). */
export function acquireLock(ref: string): boolean {
  const key = `verifone:lock:${ref}`;
  if (cacheGet(key)) return false;
  cacheSet(key, true, 120);
  return true;
}

export function releaseLock(ref: string): void {
  cacheSet(`verifone:lock:${ref}`, false, 1);
}

export function setOrderResult(ref: string, result: OrderResult): void {
  orderResults.set(ref, result);
}

export function getOrderResult(ref: string): OrderResult | undefined {
  return orderResults.get(ref);
}
