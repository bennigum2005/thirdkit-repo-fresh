// src/lib/checkoutFinalize.ts — server only.
// Placing an order is a sequence (course ch. 6). Steps 3–7 run at checkout
// time in prepareCheckout(); step 8 (placeOrder) runs ONLY after payment is
// confirmed — on the webhook path (course ch. 7) — via placeFinalOrder().
// Every payment path must go through these two functions, no copies.
import "server-only";
import { magentoClient } from "./magentoClient";

export type CheckoutForm = {
  email: string;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
};

/**
 * Their Magento requires a region on Icelandic addresses ("Region is
 * required"). We resolve it from the postcode (course ch. 6: region_id —
 * resolved from the postcode) so the customer never sees an extra field.
 */
function isoRegionForPostcode(postcode: string): string {
  const n = parseInt(postcode, 10);
  if (isNaN(n)) return "IS-01";
  if (n === 190 || (n >= 230 && n <= 262)) return "IS-02"; // Suðurnes
  if (n < 300) return "IS-01"; // Höfuðborgarsvæði
  if (n < 380) return "IS-03"; // Vesturland
  if (n < 500) return "IS-04"; // Vestfirðir
  if (n < 580) return "IS-05"; // Norðurland vestra
  if (n < 690) return "IS-06"; // Norðurland eystra
  if (n < 800) return "IS-07"; // Austurland
  return "IS-08"; // Suðurland
}

let regionCache: Record<string, number> | null = null;

async function resolveRegionId(postcode: string): Promise<number | undefined> {
  if (!regionCache) {
    type Regions = { country: { available_regions: Array<{ id: number; code: string }> } };
    const data = await magentoClient().request<Regions>(
      /* GraphQL */ `{ country(id: "IS") { available_regions { id code } } }`
    );
    regionCache = {};
    for (const r of data.country.available_regions ?? []) regionCache[r.code] = r.id;
  }
  return regionCache[isoRegionForPostcode(postcode)];
}

export type CheckoutSummary = {
  grandTotal: number;
  currency: string;
  shipping: { carrier: string; method: string; title: string; amount: number };
  paymentMethods: Array<{ code: string; title: string }>;
  paymentSet: string | null;
};

/** Steps 3–7: make the cart "ready to place". Returns server-computed totals. */
export async function prepareCheckout(cartId: string, form: CheckoutForm): Promise<CheckoutSummary> {
  const client = magentoClient();

  // 3 · guest email — a guest order needs somewhere to send the confirmation
  await client.request(
    /* GraphQL */ `
      mutation setGuestEmail($cartId: String!, $email: String!) {
        setGuestEmailOnCart(input: { cart_id: $cartId, email: $email }) {
          cart { email }
        }
      }
    `,
    { cartId, email: form.email.trim() }
  );

  // 4 · shipping address — an address object inside an array, country is ISO,
  //     region resolved from the postcode
  const regionId = await resolveRegionId(form.postalCode.trim());
  const addr = {
    address: {
      firstname: form.firstName.trim(),
      lastname: form.lastName.trim(),
      street: [form.address.trim()],
      city: form.city.trim(),
      ...(regionId ? { region_id: regionId } : {}),
      postcode: form.postalCode.trim(),
      telephone: form.phone.trim(),
      country_code: "IS",
    },
  };
  await client.request(
    /* GraphQL */ `
      mutation setAddress($cartId: String!, $addr: ShippingAddressInput!) {
        setShippingAddressesOnCart(input: { cart_id: $cartId, shipping_addresses: [$addr] }) {
          cart { id }
        }
      }
    `,
    { cartId, addr }
  );

  // 5 · billing address — same values, do not skip the call
  await client.request(
    /* GraphQL */ `
      mutation setBilling($cartId: String!, $addr: BillingAddressInput!) {
        setBillingAddressOnCart(input: { cart_id: $cartId, billing_address: $addr }) {
          cart { id }
        }
      }
    `,
    { cartId, addr }
  );

  // 6 · shipping method — ask what is available first, then set one
  type Methods = {
    cart: {
      shipping_addresses: Array<{
        available_shipping_methods: Array<{
          carrier_code: string;
          method_code: string;
          carrier_title: string;
          method_title: string;
          amount: { value: number; currency: string };
        }>;
      }>;
    };
  };
  const res = await client.request<Methods>(
    /* GraphQL */ `
      query getShippingMethods($cartId: String!) {
        cart(cart_id: $cartId) {
          shipping_addresses {
            available_shipping_methods {
              carrier_code method_code carrier_title method_title
              amount { value currency }
            }
          }
        }
      }
    `,
    { cartId }
  );
  const available = res.cart.shipping_addresses[0]?.available_shipping_methods ?? [];
  if (!available.length) {
    // An empty list is a real failure — usually a rejected address (course ch. 6)
    throw new Error("NO_SHIPPING_METHODS");
  }
  const preferredCarrier = process.env.PREFERRED_CARRIER_CODE ?? "flatrate";
  const chosen =
    available.find((m) => m.carrier_code === preferredCarrier) ??
    [...available].sort((a, b) => a.amount.value - b.amount.value)[0];
  if (chosen.carrier_code !== preferredCarrier) {
    console.warn(`Shipping fallback used for cart ${cartId}: ${chosen.carrier_code}/${chosen.method_code}`);
  }
  await client.request(
    /* GraphQL */ `
      mutation setShipping($cartId: String!, $carrier: String!, $method: String!) {
        setShippingMethodsOnCart(input: {
          cart_id: $cartId
          shipping_methods: [{ carrier_code: $carrier, method_code: $method }]
        }) { cart { id } }
      }
    `,
    { cartId, carrier: chosen.carrier_code, method: chosen.method_code }
  );

  // 7 · payment method — list what the cart offers; set one if configured.
  //     Gateway methods can appear in the list and still be rejected by
  //     setPaymentMethodOnCart — keep an offline fallback for the webhook path.
  type Totals = {
    cart: {
      prices: { grand_total: { value: number; currency: string } };
      available_payment_methods: Array<{ code: string; title: string }>;
    };
  };
  const totals = await client.request<Totals>(
    /* GraphQL */ `
      query totals($cartId: String!) {
        cart(cart_id: $cartId) {
          prices { grand_total { value currency } }
          available_payment_methods { code title }
        }
      }
    `,
    { cartId }
  );
  const paymentMethods = totals.cart.available_payment_methods ?? [];

  let paymentSet: string | null = null;
  const wanted = process.env.PAYMENT_METHOD_CODE;
  const codeToSet =
    (wanted && paymentMethods.find((m) => m.code === wanted)?.code) ??
    paymentMethods.find((m) => ["checkmo", "banktransfer", "cashondelivery", "free"].includes(m.code))?.code;
  if (codeToSet) {
    try {
      await client.request(
        /* GraphQL */ `
          mutation setPayment($cartId: String!, $code: String!) {
            setPaymentMethodOnCart(input: { cart_id: $cartId, payment_method: { code: $code } }) {
              cart { id }
            }
          }
        `,
        { cartId, code: codeToSet }
      );
      paymentSet = codeToSet;
    } catch (e) {
      console.warn(`setPaymentMethodOnCart rejected '${codeToSet}': ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    grandTotal: totals.cart.prices.grand_total.value,
    currency: totals.cart.prices.grand_total.currency,
    shipping: {
      carrier: chosen.carrier_code,
      method: chosen.method_code,
      title: `${chosen.carrier_title} — ${chosen.method_title}`,
      amount: chosen.amount.value,
    },
    paymentMethods,
    paymentSet,
  };
}

/** Step 8: place the order. Called from the payment webhook — never the browser. */
export async function placeFinalOrder(cartId: string): Promise<{ orderNumber: string | null }> {
  type PlaceRes = {
    placeOrder: {
      order?: { order_number?: string };
      orderV2?: { number?: string };
      errors?: Array<{ message: string }>;
    };
  };
  const placed = await magentoClient().request<PlaceRes>(
    /* GraphQL */ `
      mutation placeOrder($cartId: String!) {
        placeOrder(input: { cart_id: $cartId }) {
          order { order_number }
          orderV2 { number }
          errors { message }
        }
      }
    `,
    { cartId }
  );

  const orderNumber =
    placed?.placeOrder?.order?.order_number ??
    placed?.placeOrder?.orderV2?.number ??
    null;

  if (!orderNumber) {
    // Do NOT assume failure and do NOT retry placeOrder (it would ship twice).
    // The safe move is an admin lookup by email within a short time window.
    console.error(`placeOrder returned no number for cart ${cartId} — verify via admin lookup`);
  }
  return { orderNumber };
}
