// src/app/api/pay/route.ts
// Initiates payment (course ch. 7 leg 1): final stock check, payment method
// set on the cart, amount computed FROM MAGENTO, session created, shopper
// redirected. The order itself is created by the webhook — never here.
import { ensureCartId, fetchCart } from "@/lib/cart";
import { getTotalsAndPayments, setPaymentMethod } from "@/lib/checkoutFinalize";
import { checkCartStock } from "@/lib/stockCheck";
import { createPaymentSession, setOrderResult } from "@/lib/payment";

export async function POST() {
  try {
    const cartId = await ensureCartId();

    const cart = await fetchCart(cartId);
    if (!cart.items.length) {
      return Response.json({ error: "EMPTY_CART" }, { status: 409 });
    }

    // Last line of defence before money changes hands (practice step 7)
    const stock = await checkCartStock(cartId);
    if (!stock.ok) {
      return Response.json({ error: "OUT_OF_STOCK", unavailable: stock.unavailable }, { status: 409 });
    }

    // Step 7 of ch. 6: a payment method must be on the cart before placeOrder.
    const totals = await getTotalsAndPayments(cartId);
    const wanted = process.env.PAYMENT_METHOD_CODE;
    const candidates = [
      ...(wanted ? [wanted] : []),
      "checkmo", "banktransfer", "cashondelivery", "free", "purchaseorder",
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

    const session = await createPaymentSession({
      cartId,
      amount: totals.grandTotal, // from Magento — never from the browser
      currency: totals.currency,
    });

    setOrderResult(cartId, { status: "pending" });
    return Response.json({ redirectUrl: session.redirectUrl });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "PAY_INIT_FAILED" }, { status: 502 });
  }
}
