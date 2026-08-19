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
  isKnownPostcode,
  setDroppOnCart,
  type CheckoutForm,
  type ShippingMethod,
} from "@/lib/checkoutFinalize";
import { checkCartStock } from "@/lib/stockCheck";
import { homeDeliveryAvailable } from "@/lib/dropp";
import { checkAddress } from "@/lib/addressRegistry";
import { droppPricesFor, DROPP_HOME_DELIVERY_LOCATION_ID } from "@/lib/droppPricing";
import { captureError } from "@/lib/errorMonitor";

const REQUIRED: Array<keyof CheckoutForm> = [
  "email", "firstName", "lastName", "address", "postalCode", "phone",
];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<CheckoutForm> & {
      shipping?: { carrier?: string; method?: string };
      droppLocation?: { id?: string; name?: string; address?: string };
      deliveryKind?: string; // "dropp" | "home" | "store" — the UX-level choice
    };

    for (const field of REQUIRED) {
      if (typeof body[field] !== "string" || !body[field]!.trim()) {
        return Response.json({ error: "MISSING_FIELD", field }, { status: 400 });
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(body.email!.trim())) {
      return Response.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    // An address with a nonexistent postcode is not an address (Dropp resolves
    // everything from the postcode, so this is the gate that matters).
    if (!isKnownPostcode(body.postalCode!)) {
      return Response.json({ error: "INVALID_POSTCODE" }, { status: 400 });
    }
    // The address itself must exist in Staðfangaskrá (the official registry).
    // A made-up street or house number stops here, before Magento sees it.
    const addr = await checkAddress(body.address!, body.postalCode!);
    if (addr.known && !addr.ok) {
      return Response.json(
        { error: "ADDRESS_NOT_FOUND", reason: addr.reason, postcode: body.postalCode!.trim() },
        { status: 400 }
      );
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

    // The SITE decides shipping prices (Dropp verðskrá, one definition) — the
    // Magento methods only carry the choice. Subtotal = items after discount.
    const subtotal = cart.items.reduce((s, i) => s + i.rowTotal, 0);
    const prices = droppPricesFor(body.postalCode!.trim(), subtotal);

    // Phase A: no choice made yet — hand the list + OUR prices to the browser
    if (!body.shipping?.carrier || !body.shipping?.method) {
      return Response.json({ phase: "methods", methods, droppPrices: prices });
    }

    // Phase B — the kind is the real choice; the server maps it to a method.
    const isStore = (m: ShippingMethod) => /instore|pickup|verslun/i.test(`${m.carrier} ${m.method} ${m.title}`);
    const storeM = methods.find(isStore);
    const delivery = methods.filter((m) => !isStore(m));
    const freeM = delivery.find((m) => /free/i.test(m.carrier));
    const paidM = [...delivery].filter((m) => !/free/i.test(m.carrier)).sort((a, b) => a.amount - b.amount)[0];

    const kind =
      body.deliveryKind === "home" || body.deliveryKind === "dropp" || body.deliveryKind === "store"
        ? body.deliveryKind
        : null;

    let chosen: ShippingMethod | undefined;
    let shipPrice = 0;
    if (kind === "home") {
      // Heimsending the way Dropp does it: postcode must be on their
      // deliveryzips list — and it is NEVER free.
      const home = await homeDeliveryAvailable(body.postalCode!.trim());
      if (home.known && !home.available) {
        return Response.json(
          { error: "HOME_DELIVERY_UNAVAILABLE", postcode: body.postalCode!.trim() },
          { status: 422 }
        );
      }
      shipPrice = prices.home;
      chosen = paidM ?? freeM;
    } else if (kind === "dropp") {
      if (!dropp?.id) {
        return Response.json({ error: "INVALID_SHIPPING" }, { status: 422 });
      }
      shipPrice = prices.pickup; // 0 over the threshold — pickup only
      chosen = shipPrice === 0 ? (freeM ?? paidM) : (paidM ?? freeM);
    } else if (kind === "store") {
      shipPrice = 0;
      chosen = storeM;
    } else {
      // Legacy caller: validate the explicit carrier/method pair
      chosen = methods.find(
        (m) => m.carrier === body.shipping!.carrier && m.method === body.shipping!.method
      );
      shipPrice = chosen?.amount ?? 0;
    }
    if (!chosen) {
      return Response.json({ error: "INVALID_SHIPPING" }, { status: 422 });
    }

    // Practice step 7: stock check immediately before payment — an
    // out-of-stock line blocks the flow with a clear message.
    const stock = await checkCartStock(cartId);
    if (!stock.ok) {
      return Response.json({ error: "OUT_OF_STOCK", unavailable: stock.unavailable }, { status: 409 });
    }

    // Store the location + PRICE on the cart via Jói's custom module, so
    // Magento charges the same number the shopper saw. joiweb rule: if the
    // price fails to save, ABORT — a failed checkout beats a wrong charge.
    if (kind === "dropp" || kind === "home") {
      const pickupId = kind === "home" ? DROPP_HOME_DELIVERY_LOCATION_ID : String(dropp!.id);
      const addrLine =
        kind === "home"
          ? `Heimsending: ${body.address!.trim()}, ${body.postalCode!.trim()}`
          : `${String(dropp!.name ?? "")}${dropp!.address ? ` — ${String(dropp!.address)}` : ""}`;
      try {
        await setDroppOnCart(cartId, pickupId, shipPrice, addrLine);
      } catch (err) {
        captureError("checkout setDroppOnCart", err);
        if (shipPrice > 0) {
          return Response.json({ error: "SHIPPING_PRICE_FAILED" }, { status: 502 });
        }
        // price 0 — nothing to charge, continue without the module
      }
    }

    await chooseShipping(cartId, chosen.carrier, chosen.method);

    const totals = await getTotalsAndPayments(cartId);
    // Verify the write landed: the charged total must reflect our price
    if (shipPrice > 0 && totals.grandTotal < subtotal + shipPrice) {
      captureError(
        "checkout shipping-price",
        new Error(`grand_total ${totals.grandTotal} < subtotal ${subtotal} + ship ${shipPrice}`)
      );
    }
    return Response.json({
      phase: "summary",
      shipping: { ...chosen, amount: shipPrice },
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
