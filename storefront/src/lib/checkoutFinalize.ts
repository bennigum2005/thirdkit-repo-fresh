// src/lib/checkoutFinalize.ts — server only.
// Placing an order is a sequence (course ch. 6). Steps 3–5 set the customer
// info, the shopper then CHOOSES a shipping method from what Magento offers
// (Dropp, Pósturinn, …), step 7 prepares payment, and step 8 (placeOrder)
// runs ONLY after payment is confirmed — on the webhook path (course ch. 7).
import "server-only";
import { magentoClient } from "./magentoClient";

export type CheckoutForm = {
  email: string;
  firstName: string;
  lastName: string;
  address: string;
  city?: string; // derived from the postcode when not provided
  postalCode: string;
  phone: string;
};

/** Icelandic postcode → town, so the customer never types it. */
const TOWNS: Array<[number, number, string]> = [
  [100, 162, "Reykjavík"], [170, 172, "Seltjarnarnes"], [190, 191, "Vogar"],
  [200, 206, "Kópavogur"], [210, 212, "Garðabær"], [220, 222, "Hafnarfjörður"],
  [225, 225, "Garðabær"], [230, 235, "Reykjanesbær"], [240, 241, "Grindavík"],
  [245, 251, "Suðurnesjabær"], [260, 262, "Reykjanesbær"], [270, 277, "Mosfellsbær"],
  [300, 302, "Akranes"], [310, 312, "Borgarnes"], [320, 321, "Reykholt"],
  [340, 342, "Stykkishólmur"], [345, 346, "Flatey"], [350, 351, "Grundarfjörður"],
  [355, 356, "Snæfellsbær"], [360, 361, "Hellissandur"], [370, 371, "Búðardalur"],
  [380, 381, "Reykhólahreppur"], [400, 401, "Ísafjörður"], [410, 411, "Hnífsdalur"],
  [415, 416, "Bolungarvík"], [420, 421, "Súðavík"], [425, 426, "Flateyri"],
  [430, 431, "Suðureyri"], [450, 451, "Patreksfjörður"], [460, 461, "Tálknafjörður"],
  [465, 466, "Bíldudalur"], [470, 471, "Þingeyri"], [500, 531, "Hvammstangi"],
  [540, 546, "Blönduós"], [550, 561, "Sauðárkrókur"], [565, 570, "Hofsós"],
  [580, 581, "Siglufjörður"], [600, 607, "Akureyri"], [610, 616, "Grenivík"],
  [620, 621, "Dalvík"], [625, 626, "Ólafsfjörður"], [630, 631, "Hrísey"],
  [640, 641, "Húsavík"], [645, 661, "Laugar"], [670, 676, "Kópasker"],
  [680, 686, "Þórshöfn"], [690, 691, "Vopnafjörður"], [700, 701, "Egilsstaðir"],
  [710, 711, "Seyðisfjörður"], [715, 716, "Mjóifjörður"], [720, 721, "Borgarfjörður eystri"],
  [730, 731, "Reyðarfjörður"], [735, 736, "Eskifjörður"], [740, 741, "Neskaupstaður"],
  [750, 751, "Fáskrúðsfjörður"], [755, 756, "Stöðvarfjörður"], [760, 761, "Breiðdalsvík"],
  [765, 766, "Djúpivogur"], [780, 781, "Höfn í Hornafirði"], [785, 786, "Öræfi"],
  [800, 806, "Selfoss"], [810, 811, "Hveragerði"], [815, 816, "Þorlákshöfn"],
  [820, 826, "Eyrarbakki"], [840, 846, "Flúðir"], [850, 851, "Hella"],
  [860, 861, "Hvolsvöllur"], [870, 871, "Vík"], [880, 881, "Kirkjubæjarklaustur"],
  [900, 903, "Vestmannaeyjar"],
];

export function townForPostcode(postcode: string): string {
  const n = parseInt(postcode, 10);
  if (!isNaN(n)) {
    for (const [from, to, town] of TOWNS) {
      if (n >= from && n <= to) return town;
    }
  }
  return "Reykjavík";
}

export type ShippingMethod = {
  carrier: string;
  method: string;
  title: string;
  amount: number;
};

/**
 * Their Magento requires a region on Icelandic addresses. We resolve it from
 * the postcode (course ch. 6: region_id — resolved from the postcode) so the
 * customer never sees an extra field.
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

/** Steps 3–5: guest email, shipping address (region from postcode), billing.
 *  extraStreetLine carries the chosen Dropp location onto the order address. */
export async function setCustomerInfo(cartId: string, form: CheckoutForm, extraStreetLine?: string): Promise<void> {
  const client = magentoClient();

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

  const regionId = await resolveRegionId(form.postalCode.trim());
  const city = form.city?.trim() || townForPostcode(form.postalCode.trim());
  const addr = {
    address: {
      firstname: form.firstName.trim(),
      lastname: form.lastName.trim(),
      street: extraStreetLine
        ? [form.address.trim(), extraStreetLine.slice(0, 120)]
        : [form.address.trim()],
      city,
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

  // Billing — same values, do not skip the call (course ch. 6)
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
}

/** Step 6a: ask Magento which shipping methods THIS cart and address can use. */
export async function getShippingMethods(cartId: string): Promise<ShippingMethod[]> {
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
  const res = await magentoClient().request<Methods>(
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
  return available.map((m) => ({
    carrier: m.carrier_code,
    method: m.method_code,
    title: m.method_title && m.method_title !== m.carrier_title
      ? `${m.carrier_title} — ${m.method_title}`
      : m.carrier_title,
    amount: m.amount.value,
  }));
}

/** Step 6b: set the method the shopper chose (validated against 6a by caller). */
export async function chooseShipping(cartId: string, carrier: string, method: string): Promise<void> {
  await magentoClient().request(
    /* GraphQL */ `
      mutation setShipping($cartId: String!, $carrier: String!, $method: String!) {
        setShippingMethodsOnCart(input: {
          cart_id: $cartId
          shipping_methods: [{ carrier_code: $carrier, method_code: $method }]
        }) { cart { id } }
      }
    `,
    { cartId, carrier, method }
  );
}

export type TotalsAndPayments = {
  grandTotal: number;
  currency: string;
  paymentMethods: Array<{ code: string; title: string }>;
};

/** Server-computed totals + the payment methods the cart offers (Valitor & co.). */
export async function getTotalsAndPayments(cartId: string): Promise<TotalsAndPayments> {
  type Totals = {
    cart: {
      prices: { grand_total: { value: number; currency: string } };
      available_payment_methods: Array<{ code: string; title: string }>;
    };
  };
  const totals = await magentoClient().request<Totals>(
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
  return {
    grandTotal: totals.cart.prices.grand_total.value,
    currency: totals.cart.prices.grand_total.currency,
    paymentMethods: totals.cart.available_payment_methods ?? [],
  };
}

/** Step 7: set a payment method on the cart. */
export async function setPaymentMethod(cartId: string, code: string): Promise<void> {
  await magentoClient().request(
    /* GraphQL */ `
      mutation setPayment($cartId: String!, $code: String!) {
        setPaymentMethodOnCart(input: { cart_id: $cartId, payment_method: { code: $code } }) {
          cart { id }
        }
      }
    `,
    { cartId, code }
  );
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
    console.error(`placeOrder returned no number for cart ${cartId} — verify via admin lookup`);
  }
  return { orderNumber };
}
