// src/lib/verifone.ts — server only.
// Verifone Hosted Checkout adapter, built VERBATIM from the joiweb production
// notes (the same contract Jói útherji runs on). The rules that matter:
//   · amount in ISK MAJOR units — never ×100
//   · the order is created in the WEBHOOK, never in the browser
//   · customer is ONLY ever a guid string — billing goes in customer_details
//   · 3DS on ⇒ full billing required, bail early instead of a useless 400
//   · error 107 = malformed string field (>22-char name, symbol in city, …)
import "server-only";

export function isVerifoneConfigured(): boolean {
  return Boolean(
    process.env.VERIFONE_BASE_URL &&
    process.env.VERIFONE_ENTITY_ID &&
    process.env.VERIFONE_USER_ID &&
    process.env.VERIFONE_API_KEY &&
    process.env.VERIFONE_PPC_ID
  );
}

/** joiweb base-url gotcha: live host must become gsc, no trailing slash. */
function baseUrl(): string {
  return (process.env.VERIFONE_BASE_URL ?? "")
    .replace("emea.live.verifone.cloud", "emea.gsc.verifone.cloud")
    .replace(/\/+$/, "");
}

/** Error 107 guard: strip symbols Verifone chokes on, collapse spaces. */
function clean(s: string, max: number): string {
  return s
    .replace(/[\/&\\|<>{}\[\]$%^*~`"“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export type VerifoneBilling = {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
  email: string;
};

/** Apple Pay: card PPC works as the contract; SCA on device ⇒ NONE. */
function applePayConfiguration(contractId: string | undefined) {
  if (!contractId) return {};
  return {
    apple_pay: { card: { sca_compliance_level: "NONE", payment_contract_id: contractId } },
  };
}

export async function createVerifoneCheckout(input: {
  ref: string; // merchant_reference, ≤50 chars
  amount: number; // ISK major units
  currency: string;
  returnUrlBase: string; // public https RETURN_URL
  cartId: string;
  billing: VerifoneBilling | null;
}): Promise<{ checkoutId: string; url: string }> {
  const tryThreeDs =
    process.env.VERIFONE_TRY_THREEDS === "true" && Boolean(process.env.VERIFONE_3DS_CONTRACT_ID);

  // 3DS demands full billing — bail BEFORE calling Verifone (joiweb rule)
  if (tryThreeDs) {
    const b = input.billing;
    const missing =
      !b || !b.firstName || !b.lastName || !b.address || !b.city || !b.postalCode || !b.phone || !b.email;
    if (missing) throw new Error("VERIFONE_3DS_BILLING_MISSING");
  }

  const cardConfig: Record<string, unknown> = {
    payment_contract_id: process.env.VERIFONE_PPC_ID,
  };
  if (tryThreeDs) {
    cardConfig.threed_secure = {
      threeds_contract_id: process.env.VERIFONE_3DS_CONTRACT_ID,
      enabled: true,
    };
  }

  const payload: Record<string, unknown> = {
    amount: input.amount, // ISK = 0 decimals, do NOT ×100
    currency_code: input.currency || "ISK",
    entity_id: process.env.VERIFONE_ENTITY_ID,
    merchant_reference: input.ref.slice(0, 50),
    interaction_type: "HPP",
    configurations: {
      card: cardConfig,
      ...applePayConfiguration(process.env.VERIFONE_APPLE_PAY_PPC_ID),
    },
    return_url: `${input.returnUrlBase}?ref=${encodeURIComponent(input.ref)}&cartId=${encodeURIComponent(input.cartId)}`,
    // notification_url rejected with error 127 on this contract — webhooks are
    // registered centrally in Verifone Central instead. Flag restores it for
    // contracts that DO accept it per-checkout.
    ...(process.env.VERIFONE_SEND_NOTIFICATION_URL === "true" && process.env.CALLBACK_URL
      ? { notification_url: process.env.CALLBACK_URL }
      : {}),
  };

  if (input.billing) {
    // customer is ONLY ever a guid string (or absent) — billing lives here:
    payload.customer_details = {
      entity_id: process.env.VERIFONE_ENTITY_ID,
      email_address: input.billing.email.trim(),
      phone_number: input.billing.phone.trim(), // yes, twice
      billing: {
        address_1: clean(input.billing.address, 60),
        city: clean(input.billing.city, 40),
        country_code: "IS",
        state: clean(input.billing.city, 40), // no states in Iceland — reuse city
        first_name: clean(input.billing.firstName, 22), // >22 chars = error 107
        last_name: clean(input.billing.lastName, 22),
        postal_code: input.billing.postalCode.trim(),
        phone: input.billing.phone.trim(),
      },
    };
  }

  const basic = Buffer.from(
    `${process.env.VERIFONE_USER_ID}:${process.env.VERIFONE_API_KEY}`
  ).toString("base64");

  const res = await fetch(`${baseUrl()}/oidc/checkout-service/v2/checkout`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    _links?: { view?: { href?: string }; redirect?: { href?: string } };
    details?: { missing_parameters?: unknown; unexpected_parameters?: unknown };
  };

  if (!res.ok) {
    // 126 → 3DS without full billing · 127 → unknown field · 107 → malformed string
    console.error("verifone checkout failed:", res.status, JSON.stringify(data).slice(0, 800));
    throw new Error(`VERIFONE_CHECKOUT_${res.status}`);
  }

  // They have moved the url field around — read every known spot (joiweb)
  const checkoutId = String(
    data.id ?? data.checkout_id ?? data.session_id ?? data.reference ?? ""
  );
  const url =
    (data.url as string | undefined) ||
    data?._links?.view?.href ||
    data?._links?.redirect?.href ||
    (checkoutId ? `${baseUrl()}/v2/checkout/${checkoutId}/view` : "");

  if (!url) throw new Error("VERIFONE_NO_CHECKOUT_URL");
  return { checkoutId, url };
}

/** ref generation — short, unique, url-safe, ≤50 (joiweb verbatim). */
export function makeRef(cartId: string): string {
  const shortCart = String(cartId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  const ts = Date.now().toString(36).slice(-6);
  const rnd = Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
  return `${shortCart}-${ts}${rnd}`.slice(0, 50);
}
