// src/app/api/checkout/route.ts
// Two-phase checkout endpoint (course ch. 6, steps 3–7):
//   POST {form}                       → runs steps 3–5, returns the shipping
//                                       methods Magento offers (Dropp, …)
//   POST {form, shipping:{carrier,method}} → validates the choice against
//                                       Magento's own list, sets it, returns
//                                       SERVER-computed totals + payment methods
// The browser's arithmetic is never trusted; placeOrder waits for the webhook.
import { NextRequest } from "next/server";
import { ensureCartId, fetchCart, isInactiveCartError, resetCart } from "@/lib/cart";
import {
  setCustomerInfo,
  getShippingMethods,
  chooseShipping,
  getTotalsAndPayments,
  type CheckoutForm,
} from "@/lib/checkoutFinalize";

const REQUIRED: Array<keyof CheckoutForm> = [
  "email", "firstName", "lastName", "address", "city", "postalCode", "phone",
];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<CheckoutForm> & {
      shipping?: { carrier?: string; method?: string };
      droppLocation?: { id?: string; name?: string; address?: string };
    };

    for (const field of REQUIRED) {
      if (typeof body[field] !== "string" || !body[field]!.trim()) {
        return Response.json({ error: "MISSING_FIELD", field }, { status: 400 });
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(body.email!.trim())) {
      return Response.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }

    const cartId = await ensureCartId();

    const cart = await fetchCart(cartId).catch(async (err) => {
      if (isInactiveCartError(err)) {
        await resetCart();
        return null;
      }
      throw err;
    });
    if (!cart || !cart.items.length) {
      return Response.json({ error: "EMPTY_CART" }, { status: 409 });
    }

    // Steps 3–5 (idempotent — safe to run on both phases). A chosen Dropp
    // location travels on the address so fulfilment sees it on the order.
    const dropp = body.droppLocation;
    const droppLine =
      dropp?.id && dropp?.name
        ? `Dropp: ${String(dropp.name)} (${String(dropp.id)})`
        : undefined;
    await setCustomerInfo(cartId, body as CheckoutForm, droppLine);

    // Step 6a — what does Magento offer for this cart and address?
    const methods = await getShippingMethods(cartId);
    if (!methods.length) {
      // An empty list is a real failure — usually a rejected address
      return Response.json({ error: "NO_SHIPPING_METHODS" }, { status: 422 });
    }

    // Phase A: no choice made yet — hand the list to the browser
    if (!body.shipping?.carrier || !body.shipping?.method) {
      return Response.json({ phase: "methods", methods });
    }

    // Phase B: validate the choice against Magento's own list, then set it
    const chosen = methods.find(
      (m) => m.carrier === body.shipping!.carrier && m.method === body.shipping!.method
    );
    if (!chosen) {
      return Response.json({ error: "INVALID_SHIPPING" }, { status: 422 });
    }
    await chooseShipping(cartId, chosen.carrier, chosen.method);

    const totals = await getTotalsAndPayments(cartId);
    return Response.json({
      phase: "summary",
      shipping: chosen,
      grandTotal: totals.grandTotal,
      currency: totals.currency,
      paymentMethods: totals.paymentMethods,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(err);
    return Response.json({ error: "CHECKOUT_FAILED", detail: msg.slice(0, 600) }, { status: 502 });
  }
}
