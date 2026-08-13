// src/lib/checkoutFinalize.ts — server only.
// Steps 3–8 of placing an order (course ch. 6), in ONE function so every
// payment path behaves identically. Called from the payment webhook when
// chapter 7 is wired up — never from the browser.
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
  regionId?: number;
};

export type FinalizeResult = { orderNumber: string | null };

export async function finalizeCheckout(
  cartId: string,
  form: CheckoutForm,
  paymentCode: string
): Promise<FinalizeResult> {
  const client = magentoClient();

  // 3 · guest email
  await client.request(
    /* GraphQL */ `
      mutation setGuestEmail($cartId: String!, $email: String!) {
        setGuestEmailOnCart(input: { cart_id: $cartId, email: $email }) {
          cart { email }
        }
      }
    `,
    { cartId, email: form.email }
  );

  // 4 · shipping address
  const addr = {
    address: {
      firstname: form.firstName.trim(),
      lastname: form.lastName.trim(),
      street: [form.address.trim()],
      city: form.city.trim(),
      ...(form.regionId ? { region_id: form.regionId } : {}),
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

  // 6 · shipping method — ask first, then set; fall back to the cheapest and log
  type Methods = {
    cart: {
      shipping_addresses: Array<{
        available_shipping_methods: Array<{
          carrier_code: string;
          method_code: string;
          amount: { value: number };
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
              carrier_code method_code
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
    // A real failure — usually a rejected address. Do not swallow it silently.
    throw new Error(`No shipping methods available for cart ${cartId} — address likely rejected`);
  }
  const preferred =
    available.find((m) => m.carrier_code === "flatrate") ??
    [...available].sort((a, b) => a.amount.value - b.amount.value)[0];
  if (preferred.carrier_code !== "flatrate") {
    console.warn(`Shipping fallback used for cart ${cartId}: ${preferred.carrier_code}/${preferred.method_code}`);
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
    { cartId, carrier: preferred.carrier_code, method: preferred.method_code }
  );

  // 7 · payment method (offline fallback code allowed on the webhook path —
  //     the money is already taken, the order MUST be created)
  await client.request(
    /* GraphQL */ `
      mutation setPayment($cartId: String!, $code: String!) {
        setPaymentMethodOnCart(input: { cart_id: $cartId, payment_method: { code: $code } }) {
          cart { id }
        }
      }
    `,
    { cartId, code: paymentCode }
  );

  // 8 · place the order — read both schema shapes; a missing number is NOT a failure
  type PlaceRes = {
    placeOrder: {
      order?: { order_number?: string };
      orderV2?: { number?: string };
      errors?: Array<{ message: string }>;
    };
  };
  const placed = await client.request<PlaceRes>(
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
    // The order may exist without a number coming back — the caller should
    // fall back to an admin API lookup by email within a short time window,
    // NOT retry placeOrder (that would ship twice).
    console.error(`placeOrder returned no number for cart ${cartId} — verify via admin lookup`);
  }

  return { orderNumber };
}
