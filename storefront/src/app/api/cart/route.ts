// src/app/api/cart/route.ts — the storefront's own backend (course ch. 3 & 5).
// The browser only ever talks to these handlers; only the server talks to Magento.
import { NextRequest } from "next/server";
import {
  ensureCartId,
  fetchCart,
  addToCart,
  updateItemQty,
  removeItem,
  resetCart,
  isInactiveCartError,
} from "@/lib/cart";

export async function GET() {
  try {
    const cartId = await ensureCartId();
    try {
      const cart = await fetchCart(cartId);
      return Response.json(cart);
    } catch (err) {
      // Inactive cart after an order (ch. 5 step 4) — recover invisibly
      if (isInactiveCartError(err)) {
        await resetCart();
        const freshId = await ensureCartId();
        return Response.json(await fetchCart(freshId));
      }
      throw err;
    }
  } catch (err) {
    console.error(err);
    return new Response("Cart unavailable", { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sku, qty } = await request.json();
    if (typeof sku !== "string" || !sku) return new Response("Missing sku", { status: 400 });
    const quantity = Math.min(10, Math.max(1, Number(qty) || 1));

    const cartId = await ensureCartId();
    try {
      await addToCart(cartId, sku, quantity);
    } catch (err) {
      if (isInactiveCartError(err)) {
        await resetCart();
        const freshId = await ensureCartId();
        await addToCart(freshId, sku, quantity);
      } else {
        throw err;
      }
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return new Response("Could not add to cart", { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { uid, qty } = await request.json();
    if (typeof uid !== "string" || !uid) return new Response("Missing uid", { status: 400 });
    const quantity = Math.min(10, Math.max(1, Number(qty) || 1));
    const cartId = await ensureCartId();
    await updateItemQty(cartId, uid, quantity);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return new Response("Could not update cart", { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { uid } = await request.json();
    if (typeof uid !== "string" || !uid) return new Response("Missing uid", { status: 400 });
    const cartId = await ensureCartId();
    await removeItem(cartId, uid);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return new Response("Could not remove item", { status: 502 });
  }
}
