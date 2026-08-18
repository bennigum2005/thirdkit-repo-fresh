// src/app/api/payment-webhook/route.ts
// THE webhook (course ch. 7): the only place an order is created. Signed,
// idempotent, retry-safe. When a real provider replaces the sandbox, only
// the payload parsing changes — the rules do not.
import { NextRequest } from "next/server";
import { verifySignature, seenEvent, acquireLock, releaseLock, setOrderResult, getSnapshot } from "@/lib/payment";
import { placeFinalOrder } from "@/lib/checkoutFinalize";
import { isInactiveCartError } from "@/lib/cart";

export async function POST(request: NextRequest) {
  // Rule 4: verify the signature before trusting a single byte
  const rawBody = await request.text();
  const signature = request.headers.get("x-payment-signature") ?? "";
  if (!verifySignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: { eventId?: string; ref?: string; cartId?: string; status?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  const eventId = payload.eventId;
  const ref = payload.ref ?? payload.cartId; // legacy field name
  if (!eventId || !ref) return new Response("Missing fields", { status: 400 });
  if (payload.status !== "paid") return new Response("Ignored", { status: 200 });

  // The ref maps to the Magento cart via the snapshot (24h TTL); an old-style
  // delivery where ref IS the cart id still works.
  const cartId = getSnapshot(ref)?.cartId ?? ref;

  // Rule 3a: dedupe on the event id — two deliveries, one order
  if (seenEvent(eventId)) return new Response("Already processed", { status: 200 });

  // Rule 3b: lock per reference while we work
  if (!acquireLock(ref)) return new Response("In progress", { status: 200 });

  try {
    // SAFETY: this talks to PRODUCTION Magento. Real orders are only created
    // when PLACE_REAL_ORDERS=true is set deliberately (course: ask before
    // touching anything that moves money). Until then the placement is
    // simulated so the whole flow can be exercised harmlessly.
    if (process.env.PLACE_REAL_ORDERS !== "true") {
      setOrderResult(ref, { status: "placed", orderNumber: "SANDBOX-ÆFING" });
      console.log(`Webhook ${eventId}: SIMULATED order for cart ${cartId} (PLACE_REAL_ORDERS not enabled)`);
      return new Response("OK (simulated)", { status: 200 });
    }

    // Rule 2: the money is taken — the order MUST be created
    const { orderNumber } = await placeFinalOrder(cartId);
    setOrderResult(ref, { status: "placed", orderNumber: orderNumber ?? undefined });
    console.log(`Webhook ${eventId}: order ${orderNumber ?? "(number pending lookup)"} for cart ${cartId}`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    if (isInactiveCartError(err)) {
      // Cart already converted to an order by an earlier delivery — success
      setOrderResult(ref, { status: "placed" });
      return new Response("Already placed", { status: 200 });
    }
    console.error(`Webhook ${eventId} failed for cart ${cartId}:`, err);
    setOrderResult(ref, { status: "failed" });
    // Non-200 so the provider retries — the payment DID happen
    return new Response("Temporary error, please retry", { status: 500 });
  } finally {
    releaseLock(ref);
  }
}
