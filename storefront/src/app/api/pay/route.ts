// src/app/api/pay/route.ts
// Initiates payment, per the joiweb production playbook:
//   1 · stock check BEFORE creating the psp session
//   2 · total computed server-side from Magento — one truth, one place
//   3 · snapshot cached under verifone:form:{ref} (24h TTL)
//   4 · Verifone hosted checkout when configured; built-in sandbox otherwise
//   5 · total <= 0 → skip Verifone entirely (it rejects 0 amounts)
// The ORDER is created by the webhook. Never here, never in the browser.
import { NextRequest } from "next/server";
import { ensureCartId, fetchCart } from "@/lib/cart";
import {
  getTotalsAndPayments,
  setPaymentMethod,
  getCartBilling,
  placeFinalOrder,
} from "@/lib/checkoutFinalize";
import { checkCartStock } from "@/lib/stockCheck";
import { setOrderResult, saveSnapshot, mapCheckoutId } from "@/lib/payment";
import { isVerifoneConfigured, createVerifoneCheckout, makeRef } from "@/lib/verifone";
import { captureError } from "@/lib/errorMonitor";

export async function POST(request: NextRequest) {
  try {
    const cartId = await ensureCartId();

    const cart = await fetchCart(cartId);
    // joiweb war story: assert on total AND item count — a payable order with
    // zero items in it shipped once. Never again.
    if (!cart.items.length) {
      return Response.json({ error: "EMPTY_CART" }, { status: 409 });
    }

    // Rule: validate stock BEFORE creating the payment session
    const stock = await checkCartStock(cartId);
    if (!stock.ok) {
      return Response.json({ error: "OUT_OF_STOCK", unavailable: stock.unavailable }, { status: 409 });
    }

    const totals = await getTotalsAndPayments(cartId);

    // Free orders (total <= 0): Verifone rejects 0 amounts — place directly
    // with a free-style method, no psp involved.
    if (totals.grandTotal <= 0) {
      const freeRef = makeRef(cartId);
      const freeCandidates = ["free", "checkmo", "banktransfer"];
      let set = false;
      for (const code of freeCandidates) {
        if (!totals.paymentMethods.some((m) => m.code === code)) continue;
        try { await setPaymentMethod(cartId, code); set = true; break; } catch {}
      }
      if (!set) {
        return Response.json({ error: "PAYMENT_METHOD_UNAVAILABLE", available: totals.paymentMethods }, { status: 422 });
      }
      if (process.env.PLACE_REAL_ORDERS === "true") {
        const { orderNumber } = await placeFinalOrder(cartId);
        setOrderResult(freeRef, { status: "placed", orderNumber: orderNumber ?? undefined });
      } else {
        setOrderResult(freeRef, { status: "placed", orderNumber: "SANDBOX-ÆFING (frí pöntun)" });
      }
      return Response.json({ redirectUrl: `/stadfesting?ref=${encodeURIComponent(freeRef)}` });
    }

    // Guard the paid path (joiweb verbatim)
    if (!(totals.grandTotal > 0)) {
      throw new Error(`Invalid payment total: ${totals.grandTotal} ISK`);
    }

    // A payment method must be on the cart before placeOrder (course ch. 6-7).
    const wanted = process.env.PAYMENT_METHOD_CODE;
    const candidates = [
      ...(wanted ? [wanted] : []),
      "verifone_hosted", // Jói útherji's Verifone module — orders flow like theirs
      "checkmo", "banktransfer", "cashondelivery", "purchaseorder",
    ];
    let paymentSet: string | null = null;
    for (const code of candidates) {
      if (!totals.paymentMethods.some((m) => m.code === code)) continue;
      try {
        await setPaymentMethod(cartId, code);
        paymentSet = code;
        break;
      } catch {
        // Gateway methods can be listed and still rejected — try the next
      }
    }
    if (!paymentSet) {
      return Response.json(
        { error: "PAYMENT_METHOD_UNAVAILABLE", available: totals.paymentMethods },
        { status: 422 }
      );
    }

    // ref: short, unique, url-safe, ≤50 — this is the merchant_reference
    const ref = makeRef(cartId);
    saveSnapshot(ref, { cartId, amount: totals.grandTotal, currency: totals.currency });
    setOrderResult(ref, { status: "pending" });

    if (isVerifoneConfigured()) {
      const billing = await getCartBilling(cartId).catch(() => null);
      // Verifone error 107 guard: the return_url MUST be a valid https uri.
      // Repair the common typo (https// without the colon) and force https —
      // behind DO's proxy the origin can look like http://.
      const rawReturn =
        process.env.RETURN_URL?.trim() || new URL("/stadfesting", request.nextUrl.origin).toString();
      const returnUrlBase = rawReturn
        .replace(/^https?\/\//, "https://") // "https//..." → "https://..."
        .replace(/^http:\/\//, "https://");
      const session = await createVerifoneCheckout({
        ref,
        amount: totals.grandTotal, // ISK major units — do NOT ×100
        currency: totals.currency,
        returnUrlBase,
        cartId,
        billing,
      });
      mapCheckoutId(session.checkoutId, ref);
      return Response.json({ redirectUrl: session.url });
    }

    // No Verifone credentials yet → built-in sandbox keeps the flow testable
    return Response.json({ redirectUrl: `/sandbox-greidsla?ref=${encodeURIComponent(ref)}` });
  } catch (err) {
    captureError("api/pay", err);
    console.error(err);
    const msg = err instanceof Error ? err.message : "";
    return Response.json({ error: "PAY_INIT_FAILED", detail: msg.slice(0, 200) }, { status: 502 });
  }
}
