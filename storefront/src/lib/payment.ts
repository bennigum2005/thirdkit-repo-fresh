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

/** Create a payment session; returns where to send the shopper.
 *  Sandbox provider: our own hosted-checkout stand-in page. */
export async function createPaymentSession(input: {
  cartId: string;
  amount: number;
  currency: string;
}): Promise<{ redirectUrl: string }> {
  // Later: switch on process.env.PAYMENT_PROVIDER ("valitor", ...) here.
  const params = new URLSearchParams({ ref: input.cartId });
  return { redirectUrl: `/sandbox-greidsla?${params.toString()}` };
}

// ---------------------------------------------------------------------------
// In-memory state — fine for a single dev server. Production swaps this for
// Redis/Valkey (same shape) so retries and multiple instances stay safe.

const processedEvents = new Set<string>();
const locks = new Set<string>();
const orderResults = new Map<string, { status: "pending" | "placed" | "failed"; orderNumber?: string }>();

export function seenEvent(eventId: string): boolean {
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  return false;
}

export function acquireLock(ref: string): boolean {
  if (locks.has(ref)) return false;
  locks.add(ref);
  return true;
}

export function releaseLock(ref: string): void {
  locks.delete(ref);
}

export function setOrderResult(ref: string, result: { status: "pending" | "placed" | "failed"; orderNumber?: string }): void {
  orderResults.set(ref, result);
}

export function getOrderResult(ref: string): { status: "pending" | "placed" | "failed"; orderNumber?: string } | undefined {
  return orderResults.get(ref);
}
