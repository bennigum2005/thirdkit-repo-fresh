// src/app/api/coupon/route.ts
// Discount codes — applied by MAGENTO, never by the browser (one price truth).
// POST {code} applies, DELETE removes; both return the refreshed cart totals.
import { NextRequest } from "next/server";
import { ensureCartId, fetchCart } from "@/lib/cart";
import { magentoClient } from "@/lib/magentoClient";
import { cacheDel, cacheKey } from "@/lib/cache";

export async function POST(request: NextRequest) {
  const { code } = (await request.json().catch(() => ({}))) as { code?: string };
  if (!code?.trim()) return Response.json({ error: "MISSING_CODE" }, { status: 400 });
  const cartId = await ensureCartId();
  try {
    await magentoClient().request(
      /* GraphQL */ `
        mutation applyCoupon($cartId: String!, $code: String!) {
          applyCouponToCart(input: { cart_id: $cartId, coupon_code: $code }) {
            cart { id }
          }
        }
      `,
      { cartId, code: code.trim() }
    );
    cacheDel(cacheKey("cart", { cartId }));
    const cart = await fetchCart(cartId);
    return Response.json({ ok: true, cart });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("coupon:", msg);
    return Response.json({ error: "INVALID_COUPON" }, { status: 422 });
  }
}

export async function DELETE() {
  const cartId = await ensureCartId();
  try {
    await magentoClient().request(
      /* GraphQL */ `
        mutation removeCoupon($cartId: String!) {
          removeCouponFromCart(input: { cart_id: $cartId }) { cart { id } }
        }
      `,
      { cartId }
    );
    cacheDel(cacheKey("cart", { cartId }));
    const cart = await fetchCart(cartId);
    return Response.json({ ok: true, cart });
  } catch {
    return Response.json({ error: "REMOVE_FAILED" }, { status: 422 });
  }
}
