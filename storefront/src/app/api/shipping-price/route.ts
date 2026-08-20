// src/app/api/shipping-price/route.ts
// Live shipping price for the one-page checkout summary: the official Dropp
// verðskrá (droppPricing) + Dropp's own home-delivery availability.
import { NextRequest } from "next/server";
import { ensureCartId, fetchCart } from "@/lib/cart";
import { droppPricesFor } from "@/lib/droppPricing";
import { homeDeliveryAvailable } from "@/lib/dropp";

export async function GET(request: NextRequest) {
  const postcode = request.nextUrl.searchParams.get("postcode")?.trim() ?? "";
  if (!/^\d{3}$/.test(postcode)) {
    return Response.json({ error: "INVALID_POSTCODE" }, { status: 400 });
  }
  try {
    const cartId = await ensureCartId();
    const cart = await fetchCart(cartId);
    const subtotal = cart.items.reduce((s, i) => s + i.rowTotal, 0);
    const prices = droppPricesFor(postcode, subtotal);
    const home = await homeDeliveryAvailable(postcode);
    return Response.json({
      pickup: prices.pickup,
      home: prices.home,
      homeAvailable: home.known ? home.available : true,
      subtotal,
    });
  } catch (err) {
    console.error("shipping-price:", err instanceof Error ? err.message : err);
    return Response.json({ error: "UNAVAILABLE" }, { status: 502 });
  }
}
