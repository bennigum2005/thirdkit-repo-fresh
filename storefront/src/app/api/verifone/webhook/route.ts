// src/app/api/verifone/webhook/route.ts
// Verifone notification endpoint — THE place the order is created (joiweb).
// Signature: detached JWS over the RFC 8785 canonicalised body, unencoded
// payload (RFC 7797 b64:false), header x-vfi-jws.
// Return 2xx for anything handled — including "couldn't work out the
// reference" — or Verifone retries the same broken payload forever.
import { NextRequest } from "next/server";
import { createRemoteJWKSet, flattenedVerify } from "jose";

/** RFC 8785 (JCS) canonicalization: lexicographically sorted keys, ES number
 *  serialization — JSON.stringify handles the scalars, we handle the order. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  return (
    "{" +
    Object.keys(value as object)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}
import {
  seenEvent,
  acquireLock,
  releaseLock,
  setOrderResult,
  getSnapshot,
  refForCheckoutId,
} from "@/lib/payment";
import { placeFinalOrder } from "@/lib/checkoutFinalize";
import { isInactiveCartError } from "@/lib/cart";
import { captureError } from "@/lib/errorMonitor";

type AnyObj = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** merchant_reference comes under different names — or not at all (joiweb). */
function resolveReference(parsed: AnyObj, content: AnyObj): string {
  return (
    str(content.merchant_reference) || str(content.merchantReference) || str(content.reference) ||
    str(parsed.merchant_reference) || str(parsed.merchantReference) || str(parsed.reference) || ""
  );
}

export async function POST(request: NextRequest) {
  const raw = Buffer.from(await request.arrayBuffer());

  let parsed: AnyObj;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as AnyObj;
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  // --- signature -----------------------------------------------------------
  const skip = process.env.VERIFONE_WEBHOOK_SKIP_VERIFICATION === "true"; // LOCAL DEV ONLY
  if (!skip) {
    const sig = request.headers.get("x-vfi-jws") ?? "";
    const [protectedB64, empty, signatureB64] = sig.split(".");
    if (!protectedB64 || empty !== "" || !signatureB64) {
      return new Response("Bad signature header", { status: 400 });
    }
    const jwksUrl = process.env.VERIFONE_JWKS_URL;
    if (!jwksUrl) {
      captureError("verifone/webhook", new Error("VERIFONE_JWKS_URL missing"));
      return new Response("Not configured", { status: 500 });
    }
    try {
      // Build the JWKS inside the handler, not at module load — a bad env
      // var must not kill the route at boot (joiweb).
      const JWKS = createRemoteJWKSet(new URL(jwksUrl));
      const canonical = canonicalize(parsed);
      await flattenedVerify(
        {
          protected: protectedB64,
          payload: new TextEncoder().encode(canonical), // Uint8Array, b64:false
          signature: signatureB64,
        },
        JWKS
      );
    } catch (err) {
      captureError("verifone/webhook signature", err);
      return new Response("Invalid signature", { status: 403 });
    }
  }

  // --- event parsing (field names vary — read defensively) -----------------
  const content = (parsed.content ?? parsed.data ?? {}) as AnyObj;
  const eventType =
    str(parsed.event_type) || str(parsed.eventType) || str(parsed.type) || str(parsed.event) || "";
  const eventId =
    str(parsed.event_id) || str(parsed.eventId) || str(parsed.id) ||
    str(content.event_id) || str(content.eventId) || "";
  const checkoutId =
    str(content.checkout_id) || str(content.checkoutId) || str(content.checkout) || str(content.id) || "";

  let reference = resolveReference(parsed, content);
  if (!reference && checkoutId) {
    reference = refForCheckoutId(checkoutId) ?? "";
  }
  if (!reference) {
    // Handled, per the rules — log loudly, answer 200 so it doesn't retry forever
    captureError("verifone/webhook", new Error(`no reference (event ${eventId || "?"} type ${eventType || "?"})`));
    console.error("verifone webhook: could not resolve reference", eventId, eventType);
    return Response.json({ ok: true, unresolved: true });
  }

  // --- dedupe + single flight ----------------------------------------------
  if (eventId && seenEvent(eventId)) {
    return Response.json({ ok: true, duplicate: true });
  }
  if (!acquireLock(reference)) {
    return Response.json({ ok: true, locked: true });
  }

  try {
    const isSuccess = /CheckoutTransactionSuccess/i.test(eventType);
    const isFailure = /CheckoutTransactionFailed/i.test(eventType);

    if (isFailure) {
      // No order. (Failed events don't even include amount — joiweb.)
      setOrderResult(reference, { status: "payment_failed" });
      console.log(`Verifone webhook ${eventId}: FAILED payment, ref ${reference}`);
      return Response.json({ ok: true });
    }
    if (!isSuccess) {
      console.log(`Verifone webhook ${eventId}: ignored event type "${eventType}"`);
      return Response.json({ ok: true, ignored: true });
    }

    // --- success: money taken → the order MUST be created ------------------
    const snap = getSnapshot(reference);
    if (!snap) {
      // Snapshot expired (24h TTL) — money taken, no cart to place. Alert hard.
      captureError("verifone/webhook", new Error(`PAID but snapshot missing for ref ${reference}`));
      console.error(`Verifone webhook ${eventId}: PAID but no snapshot for ${reference} — manual follow-up!`);
      setOrderResult(reference, { status: "failed" });
      return Response.json({ ok: true, snapshotMissing: true }); // 2xx: retrying won't help
    }

    if (process.env.PLACE_REAL_ORDERS !== "true") {
      setOrderResult(reference, { status: "placed", orderNumber: "SANDBOX-ÆFING" });
      console.log(`Verifone webhook ${eventId}: SIMULATED order, ref ${reference}`);
      return Response.json({ ok: true, simulated: true });
    }

    const { orderNumber } = await placeFinalOrder(snap.cartId);
    setOrderResult(reference, { status: "placed", orderNumber: orderNumber ?? undefined });
    console.log(`Verifone webhook ${eventId}: order ${orderNumber ?? "(pending lookup)"} ref ${reference}`);
    return Response.json({ ok: true, orderNumber });
  } catch (err) {
    if (isInactiveCartError(err)) {
      setOrderResult(reference, { status: "placed" });
      return Response.json({ ok: true, alreadyPlaced: true });
    }
    captureError("verifone/webhook place", err);
    console.error(`Verifone webhook ${eventId} failed for ref ${reference}:`, err);
    setOrderResult(reference, { status: "failed" });
    // Payment DID happen and placing can succeed on retry → non-2xx
    return new Response("Temporary error, please retry", { status: 500 });
  } finally {
    releaseLock(reference);
  }
}
