/**
 * Verifone Checkout helpers.
 *
 * Environment variables:
 *   VERIFONE_BASE_URL   - Checkout service base URL.
 *                         Sandbox:    https://cst.test-gsc.vfims.com/oidc/checkout-service
 *                         Production: https://emea.gsc.verifone.cloud/oidc/checkout-service
 *   VERIFONE_USER_ID    - API user ID from Verifone Central
 *   VERIFONE_API_KEY    - API key from Verifone Central (secret!)
 *   VERIFONE_ENTITY_ID  - Your organisation/entity ID in Verifone Central
 *   VERIFONE_CARD_CONTRACT_ID - Payment provider contract ID for card payments
 */

function authHeader() {
  const creds = Buffer.from(`${process.env.VERIFONE_USER_ID}:${process.env.VERIFONE_API_KEY}`).toString("base64");
  return `Basic ${creds}`;
}

async function vfFetch(path, options = {}) {
  const res = await fetch(`${process.env.VERIFONE_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Verifone ${options.method || "GET"} ${path} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Create a hosted checkout. Returns { id, url } where url is the page to send the customer to. */
async function createCheckout({ amount, currency, reference, returnUrl, description }) {
  const body = {
    entity_id: process.env.VERIFONE_ENTITY_ID,
    amount: amount,               // ISK has no decimals — amount in whole krónur
    currency_code: currency,
    merchant_reference: reference,
    return_url: returnUrl,
    interaction_type: "HPP",
    configurations: {
      card: process.env.VERIFONE_CARD_CONTRACT_ID
        ? { payment_contract_id: process.env.VERIFONE_CARD_CONTRACT_ID }
        : undefined,
    },
    line_items: description ? [{ name: description, quantity: 1 }] : undefined,
  };
  const data = await vfFetch(`/v2/checkout`, { method: "POST", body: JSON.stringify(body) });
  const url = data.url || data.redirect_url
    || `${process.env.VERIFONE_BASE_URL}/v2/loader/${data.id}`;
  return { id: data.id, url };
}

/** Update a checkout (e.g. set a return_url that includes the checkout id). */
async function updateCheckout(checkoutId, body) {
  return vfFetch(`/v2/checkout/${encodeURIComponent(checkoutId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Fetch a checkout's current state to verify the payment result server-side. */
async function getCheckout(checkoutId) {
  return vfFetch(`/v2/checkout/${encodeURIComponent(checkoutId)}`);
}

module.exports = { createCheckout, updateCheckout, getCheckout };
