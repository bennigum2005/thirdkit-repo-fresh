verifone + dropp notes
from joiweb (next.js) + joi_middleware (django). both live in prod. only env var NAMES here, no values.

the one thing to get right
order gets created in the WEBHOOK. not in the browser, not on the return page.

POST /api/verifone/payment
  - check stock first (before you create the psp session)
  - work out the total server side
  - dump the whole checkout form into cache: verifone:form:{ref}
  - POST verifone /oidc/checkout-service/v2/checkout
  - return hostedCheckoutUrl, redirect the browser

customer pays on verifone's hosted page

verifone POSTs /api/verifone/webhook
  - verify jws sig
  - skip if eventId already seen
  - save verifone:payment:{ref}      <- return page polls this
  - on success: lock, read the form snapshot, CREATE THE ORDER
  - save verifone:completion:{ref}

/checkout/return?ref=...
  - poll /api/verifone/payment-status?ref=  -> pending|success|failed
  - poll /api/verifone/completion?ref=      -> orderNumber
that form snapshot is on a 1 hour TTL in joiweb. if someone leaves the payment page open longer than that: money taken, snapshot gone, no order. we've had it happen. use 24h or just stick it in the db.

other two, learned the hard way:

validate stock BEFORE creating the payment session
if you lock a single-use voucher, release it on every path that doesn't charge (verifone 4xx, no url back, thrown error, failed-payment webhook). joiweb has 4.
VERIFONE
env
VERIFONE_BASE_URL=          # https://emea.gsc.verifone.cloud
VERIFONE_ENTITY_ID=
VERIFONE_USER_ID=           # basic auth user
VERIFONE_API_KEY=           # basic auth pass
VERIFONE_PPC_ID=            # payment provider contract id
RETURN_URL=                 # https, public
CALLBACK_URL=               # https, this is the webhook
VERIFONE_JWKS_URL=
VERIFONE_TRY_THREEDS=true
VERIFONE_3DS_CONTRACT_ID=
VERIFONE_APPLE_PAY_PPC_ID=  # same value as PPC_ID on our org
VERIFONE_WEBHOOK_SKIP_VERIFICATION=true also exists. it turns off webhook signature checking so anyone who finds your webhook url can mark orders paid. local dev only, never deploy it.

base url gotcha:

url.replace('emea.live.verifone.cloud', 'emea.gsc.verifone.cloud').replace(/\/+$/, '')
creating the session
POST {BASE}/oidc/checkout-service/v2/checkout, basic auth.

const basic = Buffer.from(`${USER_ID}:${API_KEY}`).toString('base64');

const cardConfig = { payment_contract_id: PPC_ID };
if (TRY_THREEDS && THREE_DS_CONTRACT_ID) {
  cardConfig.threed_secure = { threeds_contract_id: THREE_DS_CONTRACT_ID, enabled: true };
}

const payload = {
  amount,                       // ISK = major units. 0 decimals. do NOT x100
  currency_code: 'ISK',
  entity_id: ENTITY_ID,
  merchant_reference: orderId,  // max 50 chars
  interaction_type: 'HPP',
  configurations: {
    card: cardConfig,
    ...applePayConfiguration(process.env.VERIFONE_APPLE_PAY_PPC_ID),
  },
  return_url: `${RETURN_URL}?ref=${orderId}&cartId=${cartId}`,
  notification_url: CALLBACK_URL,
};

await fetch(endpoint, {
  method: 'POST',
  headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
reading the response, they've moved the url field around:

const checkoutId = data.id || data.checkout_id || data.session_id || data.reference;
const hostedCheckoutUrl = data.url
  || data?._links?.view?.href
  || data?._links?.redirect?.href
  || `${BASE}/v2/checkout/${checkoutId}/view`;
ref generation (short, unique, url safe):

const shortCart = String(cartId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
const ts  = Date.now().toString(36).slice(-6);
const rnd = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
const orderId = `${shortCart}-${ts}${rnd}`.slice(0, 50);
3ds - the annoying bit
turning on threed_secure makes the api demand billing fields. but if you send billing as a customer object it rejects it with "customer must be a string".

answer: customer is ONLY ever a guid string (or leave it out). billing goes in a separate customer_details object, snake_case, phone twice.

const billing = {
  address_1: ...,
  city: ...,
  country_code: 'IS',
  state: city,                      // no state field in iceland, reuse city
  first_name: firstName.slice(0,22), // >22 chars = error 107
  last_name:  lastName.slice(0,22),
  postal_code: ...,
  phone: phoneNumber,
};

payload.customer_details = {
  entity_id: ENTITY_ID,
  email_address: email,
  phone_number: phoneNumber,   // yes again
  billing,
};
if billing is missing and 3ds is on, bail before you call verifone. you'll only get back a useless 400 otherwise.

error codes
126 -> details.missing_parameters, 3ds on without full billing
127 -> details.unexpected_parameters, you sent a field it doesn't know (shopper is the usual one)
107 -> malformed. ANY string field. name over 22 chars, or a symbol in city (slash, ampersand, weird punctuation). don't assume it's the name.
apple pay
whole file:

export function applePayConfiguration(contractId) {
  if (!contractId) return {};
  return {
    apple_pay: { card: { sca_compliance_level: 'NONE', payment_contract_id: contractId } },
  };
}
card PPC id works as the apple pay contract id, no separate contract needed on our org
NONE because apple pay does SCA on device. don't copy the card threed_secure block in here
to check it's live: hosted page bootstrap goes from payment_products: ["card"] to ["card","applePay"]
webhook signature
detached JWS over the RFC 8785 canonicalised body, unencoded payload (RFC 7797 b64:false). header is x-vfi-jws. copy this as is:

import { createRemoteJWKSet, flattenedVerify } from 'jose';
import { canonicalize } from 'json-canonicalize';

const raw = Buffer.from(await req.arrayBuffer());
const sig = req.headers.get('x-vfi-jws');   // base64url(protected)..base64url(sig)
const parsed = JSON.parse(raw.toString('utf8'));
const canonical = canonicalize(parsed);

const [protectedB64, empty, signatureB64] = sig.split('.');
if (!protectedB64 || empty !== '' || !signatureB64) return 400;

const jws = {
  protected: protectedB64,
  payload: new TextEncoder().encode(canonical),  // Uint8Array, b64:false
  signature: signatureB64,
};

const JWKS = createRemoteJWKSet(new URL(process.env.VERIFONE_JWKS_URL));
await flattenedVerify(jws, JWKS);   // throws -> 403
build the JWKS inside the handler, not at module load, or a bad env var kills the route at boot.

the payload lies to you
merchant_reference can just be missing. so store a reverse map when you create the session:

await valkeySet(`verifone:map:checkout:${checkoutId}`, { merchantReference: orderId }, 3600);
// then in the webhook if reference is empty, look it up by checkout id
and it comes under different names:

content?.merchant_reference || content?.merchantReference || content?.reference
  || parsed?.merchant_reference || parsed?.merchantReference || parsed?.reference || ''
failed events don't include amount at all. we fall back to the amount saved in the snapshot so the alert email isn't blank.

events: CheckoutTransactionSuccess, CheckoutTransactionFailed.

idempotency
they retry. two layers:

// dupe delivery
if (await valkeyGet(`verifone:event:${eventId}`)) return { ok: true, duplicate: true };
await valkeySet(`verifone:event:${eventId}`, true, 3600);

// single flight around order creation
const acquired = await valkeySetNX(`verifone:lock:${reference}`, '1', 120);
if (!acquired) return { ok: true, locked: true };
return 2xx for anything you handled, including "couldn't work out the reference". non-2xx just makes them retry the same broken payload forever.

free orders
if the total lands at <= 0 (full voucher), skip verifone entirely, it rejects 0 amounts. place the order directly with a free method.

and guard the paid path:

if (majorUnits <= 0) throw new Error(`Invalid payment total: ${majorUnits} ISK`);
we once shipped a payable order with zero items in it. assert on total AND item count.

ignore this stuff (magento only)
getMagentoClient, all the graphql, checkoutFinalize.ts (1388 lines of cart plumbing), setPaymentMethodOnCart('verifone_hosted'), placeOrder, the MERK-001 jersey marking line, the coupon guard. valkey* is just redis, use whatever.

the bit that IS worth keeping: work out the charge amount from your own server side truth right before charging, and place the order with exactly that number. every "customer sees X, pays Y, ERP books Z" bug we've had came from computing the total in more than one place.

DROPP
two separate jobs. don't merge them.

show pickup points + price shipping -> storefront, at checkout, Bearer token (public data)
book the actual shipment -> middleware, after picking, HTTP Basic storeId:password
the storefront never books anything. POST /api/dropp/orders exists in the next.js app but nothing calls it, it's leftover. real booking is joi_middleware/orders/dropp_client.py, runs when a picked order is completed.

auth
written in the python docstring as a warning:

auth is HTTP Basic with the store-scoped storeId:password token (NOT Bearer, the joiweb helper's Bearer header never worked against Dropp)

so:

Authorization: `Bearer ${DROPP_API_TOKEN}`   // fine for reading locations. useless for orders.
headers = {"Authorization": f"Basic {token}"}   # base64("storeId:password")
use Basic from the start, skip the week we lost on this.

base: https://api.dropp.is/dropp/api/v1, stage: https://stage.dropp.is/dropp/api/v1

locations proxy
never call dropp from the browser, token would be public. thin proxy, cache it hard, locations change maybe monthly.

export async function proxyDropp(path, init) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...init?.headers },
  });
}
// app/api/dropp/locations/route.ts
export const revalidate = 86400;
const upstream = await proxyDropp(`/dropp/locations?store=${store}`, {
  cache: 'force-cache', next: { revalidate: 3600 },
});
// pass body + content-type straight through, add:
// Cache-Control: public, max-age=3600, stale-while-revalidate=7200
routes:

/dropp/locations?store= - all pickup points
/dropp/location/deliveryzips - zips eligible for home delivery
/orders/ POST - book shipment
/orders/:id GET/PATCH/DELETE
/orders/barcode/ - label
env: DROPP_API_BASE, DROPP_API_TOKEN, NEXT_PUBLIC_DROPP_STORE_ID

picking a location
joiweb pulls the whole list once and filters client side on exact zip:

const list = Array.isArray(data) ? data : (data?.locations ?? []);  // response shape varies

const matches = droppAll.filter(loc => {
  const zip = typeof loc.addressObject?.zip === 'number'
    ? loc.addressObject.zip
    : parseZipFromAddress(loc.address);   // regex /(^|,\s*)(\d{3})\b/ fallback
  return zip === parseInt(postalCode, 10);
});
don't copy this. exact zip means someone in 221 sees nothing if the nearest point is registered as 220, and the regex fallback is flaky. locations carry gpsLatitude/gpsLongitude, sort by distance instead, and give a "show all points" option. joiweb caps at 8.

location shape:

{
  id: string,              // guid, this is what you send back to dropp
  name: string,            // "Krónan Lindir"
  address?: string,
  gpsLatitude?: number,
  gpsLongitude?: number,
  availableAt?: string | null,
  times?: [{ name, time, today }],
  addressObject?: { zip: number, town: string, street: string },
}
prices
iceland specific, just take it:

// höfuðborgarsvæðið, the 39 codes tagged Svæði="Höfuðborgarsvæðið" in íslandspóstur's list
const CAPITAL_AREA_POSTCODES = new Set([
  101,102,103,104,105,107,108,109,110,111,112,113,116,121,123,124,125,127,128,129,130,132,161,162, // rvk
  170,172,                // seltjarnarnes
  200,201,202,203,        // kópavogur
  210,212,225,            // garðabær
  220,221,222,            // hafnarfjörður
  270,271,                // mosfellsbær
  276,                    // kjósarhreppur
]);

// dropp verðskrá, 0-10kg. region = the DELIVERY postcode
const SHIPPING_PRICES = {
  droppHomeCapital:   1410,
  droppHomeOutside:   1660,
  droppPickupCapital:  870,
  droppPickupOutside: 1075,
  storePickup:           0,
};

const FREE_SHIPPING_THRESHOLD = 10000;  // pickup only. home delivery is NEVER free. strict >
function isCapitalPostcode(pc) {
  const raw = (pc ?? '').trim();
  if (!/^\d+$/.test(raw)) return false;   // "101abc" is not 101, reject don't coerce
  return CAPITAL_AREA_POSTCODES.has(parseInt(raw, 10));
}
three things people get wrong:

threshold is on the subtotal AFTER discount, strict >
region comes from the delivery postcode, not billing
this table is duplicated in the python middleware (orders/magento_to_bc_v2_fixed.py) and the two have to stay identical or the site charges one price and the ERP books another. don't do that. one definition, one place, from day one.
home delivery uses a fake location id:

const DROPP_HOME_ID = 'DROPP_HOME_DELIVERY';        // frontend sentinel
DEFAULT_HOME_DELIVERY_LOCATION_ID = "9ec1f30c-2564-4b73-8954-25b7b3186ed3"  # dropp's real one
booking the shipment
after picking, not at checkout.

body = {
    "locationId": location_id,     # pickup point guid, or the home delivery guid
    "barcode": None,
    "value": grand_total - shipping,   # goods value only, not what you charged
    "products": [                      # real stock lines only, no shipping/marking lines
        {"name": name[:120], "barcode": barcode or sku, "quantity": qty},
    ],
    "customer": {
        "name": f"{first} {last}",
        "emailAddress": ..., "address": street,
        "phoneNumber": ..., "zipcode": ..., "town": ...,
    },
}

requests.post(f"{base}/orders/", json=body,
              headers={"Authorization": f"Basic {token}"}, timeout=15)
value excludes shipping, it's for insurance/customs
filter out shipping and marking lines from products, a packing slip listing "Sendingarkostnaður" as an item confuses the courier
names truncated to 120
no token -> record a skipped row, don't crash. a booking failure must never block order completion
pickup order with no guid = hard error
ignore (magento only)
setDroppOnCart(input:{ cart_id, pickup_id, price, dropp_address }) { cart { id } }
custom magento module, lives outside the repo, not a dropp api. don't go looking for it. on a new site you just save droppLocationId + shippingCost on your own order.

the useful pattern from that code:

BEFORE charging: if the shipping price fails to save, abort. failed checkout beats charging the wrong amount.
AFTER charging: order must still go through. alert loudly, never drop an order someone already paid for.
also worth stealing: after placing the order we re-fetch it and alert if dropp_pickup_id didn't stick. verify your write actually landed whenever an ERP or courier depends on it.

checklist
verifone

[ ] ISK major units, 0 decimals
[ ] merchant_reference <= 50 chars, unique
[ ] interaction_type: 'HPP'
[ ] customer = guid string or nothing. billing in customer_details, snake_case
[ ] names cut to 22 chars
[ ] 3ds as per-request configurations.card.threed_secure, fail early if billing incomplete
[ ] webhook verifies x-vfi-jws against JWKS (canonicalize, b64:false), JWKS inside the handler
[ ] checkout_id -> ref map saved at session creation
[ ] eventId dedupe + setNX lock around order creation
[ ] order created in the webhook, return page only polls
[ ] snapshot TTL way more than 1h, or in the db
[ ] stock checked before the psp session
[ ] total <= 0 skips the psp
[ ] SKIP_VERIFICATION never in prod
[ ] alerts on: paid but order failed, missing snapshot, webhook timeout
dropp

[ ] token server side only, browser goes through your proxy
[ ] locations cached 1-24h
[ ] reads = Bearer. order booking = Basic storeId:password
[ ] price table in exactly one place
[ ] free pickup over 10.000 on post-discount subtotal, strict >. home delivery never free
[ ] home delivery uses the pseudo location id
[ ] booking after picking, never blocks order completion
[ ] location matching better than exact zip