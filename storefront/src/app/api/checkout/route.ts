// src/app/api/checkout/route.ts
// The checkout form posts here. The server runs course ch. 6 steps 3–7 and
// returns SERVER-computed totals — the browser's arithmetic is never trusted.
import { NextRequest } from "next/server";
import { ensureCartId, fetchCart, isInactiveCartError, resetCart } from "@/lib/cart";
import { prepareCheckout, type CheckoutForm } from "@/lib/checkoutFinalize";

const REQUIRED: Array<keyof CheckoutForm> = [
  "email", "firstName", "lastName", "address", "city", "postalCode", "phone",
];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<CheckoutForm>;

    for (const field of REQUIRED) {
      if (typeof body[field] !== "string" || !body[field]!.trim()) {
        return Response.json({ error: "MISSING_FIELD", field }, { status: 400 });
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(body.email!.trim())) {
      return Response.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }

    const cartId = await ensureCartId();

    // An empty cart cannot reach "ready to place"
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

    const summary = await prepareCheckout(cartId, body as CheckoutForm);
    return Response.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NO_SHIPPING_METHODS")) {
      // Usually a rejected address — surface it, do not swallow it (course ch. 6)
      return Response.json({ error: "NO_SHIPPING_METHODS" }, { status: 422 });
    }
    console.error(err);
    return Response.json({ error: "CHECKOUT_FAILED", detail: msg.slice(0, 600) }, { status: 502 });
  }
}
