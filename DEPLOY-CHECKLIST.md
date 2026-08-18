# Third Kit — pre-deployment review and checklist

**Repo:** `bennigum2005/thirdkit-repo-fresh` @ `b134b74` (main, 2026-08-18)
**Target:** DigitalOcean App Platform
**Reviewed:** 2026-08-18

---

## How this document works

Every item is **a symptom, a location, and a question you have to answer**. There
are no fixes written out. That is deliberate: if you paste this into an AI and
apply whatever it produces, you will not know whether the result is correct, and
several of these items sit directly on the path that takes money from customers
and writes orders into a live shop. You need to be able to explain each fix to
someone else before it ships.

Work top to bottom. Section 0 gates everything after it.

### What was actually checked, and what was not

- `npx tsc --noEmit` — **passes, zero errors.**
- `npm run build` (Next.js 16.3.0, Turbopack) — **passes.** 19 routes generated,
  proxy/middleware is picked up correctly.
- Full read of `storefront/src/**`, `middleware/**`, `docs/**`, the CI workflow.
- Targeted live probes: Dropp's two API endpoints, the Staðfangaskrá CSV, the
  GitHub Pages URL.

**Nothing here was exercised against a live Magento instance.** There is no
`.env.local` in the repo (correctly), so no request in this app has ever been
run end to end during this review. Every finding below comes from reading the
code plus those four probes. Treat the reasoning as sound and the runtime
behaviour as unverified until you verify it yourself.

**The build passing is not a signal that this is deployable.** Every problem in
this document is a runtime, configuration, or architecture problem. A compiler
cannot see any of them.

---

## Section 0 — Stop. Answer these three before opening DigitalOcean.

### 0.1 · Whose Magento is this pointed at?

- [ ] `storefront/src/lib/stockCheck.ts:23-25` hardcodes parent SKUs `TK01F` and
      `TK02B` as defaults. `docs/PROFANIR.md`, in the "what still needs outside
      input" list, says the real-order test must be done *"Í SAMRÁÐI við
      rekstraraðila Jóa útherja"* and that the Dropp Store ID comes out of
      *Magento admin*.
- [ ] Read that together and state, in writing, what `MAGENTO_GRAPHQL_ENDPOINT`
      is going to be set to on the DigitalOcean app. If the answer is a
      production Magento belonging to another business, this app is one
      environment variable away from writing real orders into someone else's
      live shop.

**Question to answer:** who owns the Magento this deploys against, who has
authorized this app to write to it, and is that authorization in writing?

Do not proceed past this line until that is answered. Everything below assumes
you have.

### 0.2 · This repo cannot take money as it stands.

- [ ] `storefront/src/lib/payment.ts:36-44` — `createPaymentSession()` ignores
      its `amount` and `currency` arguments and always returns a redirect to
      `/sandbox-greidsla`, a page inside this same app. There is no payment
      provider integration in the Next.js storefront. None.
- [ ] The only real Verifone code in the repo is `middleware/src/verifone.js`,
      which belongs to the abandoned Azure Functions service and is not part of
      the Next.js app at all. It will not deploy to DigitalOcean.

**Question to answer:** is the plan to deploy a storefront that cannot charge
anyone, as a staging environment? If so, say so out loud and make sure nobody
points a customer-facing domain at it. If the plan is a real shop, the payment
provider is unbuilt work, not a deployment step.

### 0.3 · What does `PLACE_REAL_ORDERS` mean here?

- [ ] `storefront/src/app/api/payment-webhook/route.ts:39-43` — unless
      `PLACE_REAL_ORDERS=true`, the webhook writes a fake result
      (`"SANDBOX-ÆFING"`) and returns without touching Magento.
- [ ] Section 1 of this document is a list of problems that are *dormant while
      that flag is off* and *all become live simultaneously the moment it is
      set to true*.

**Question to answer:** who is allowed to set that variable, and what has to be
green before they do?

---

## Section 1 — Armed the moment `PLACE_REAL_ORDERS=true`

These five are a set. Read them together.

### 1.1 · `/api/sandbox-complete` is not gated to development. Anyone can place a free order.

- [ ] `storefront/src/app/api/sandbox-complete/route.ts` — compare it to
      `storefront/src/app/api/villa-test/route.ts:5-7`, which *does* check
      `NODE_ENV === "production"` and returns 404. The sandbox endpoint has no
      such check. Neither does the `/sandbox-greidsla` page.
- [ ] Now trace what a stranger on the internet can do against the deployed site:
      1. `GET /api/cart` returns the cart as JSON — including `id`
         (`storefront/src/lib/cart.ts:102`). The cart id is not a secret from
         the browser.
      2. Add items normally.
      3. `POST /api/sandbox-complete` with that `cartId`.
      4. The **server** signs a `status: "paid"` payload with its own webhook
         secret (`sandbox-complete/route.ts:18`) and delivers it to
         `/api/payment-webhook`.
      5. The signature is valid, because the server made it.
- [ ] Walk that chain yourself with curl against a local `npm run dev` before you
      accept this finding. You need a `.env.local` with a working
      `MAGENTO_GRAPHQL_ENDPOINT` first — step 1 mints a real guest cart and
      cannot run without it — and leave `PLACE_REAL_ORDERS` unset, so the
      webhook stops at the simulated branch (1.4 / `payment-webhook/route.ts:39`)
      and you see the whole chain complete without creating a real order.

**Question to answer:** which routes and pages in this app are development-only,
and what mechanism keeps them from being reachable in production? Right now the
answer is "one route checks, the others don't".

### 1.2 · The webhook secret has a working default.

- [ ] `storefront/src/lib/payment.ts:12-19` — if `PAYMENT_WEBHOOK_SECRET` is
      unset, `secret()` logs a warning and returns the literal string
      `"dev-only-secret-change-me"`, which is committed to a public repo.
- [ ] A `console.warn` in a DigitalOcean runtime log is not a safeguard. Nobody
      reads it.

**Question to answer:** what should a missing payment secret do — warn, or refuse
to start? Which of those two is a decision you want made by whoever forgets to
set the variable?

### 1.3 · `/api/pay` will settle on a payment method that means "not paid".

- [ ] `storefront/src/app/api/pay/route.ts:28-31` — the candidate list is
      `PAYMENT_METHOD_CODE` (if set), then `checkmo`, `banktransfer`,
      `cashondelivery`, `free`, `purchaseorder`. It takes the first one Magento
      offers.
- [ ] Every one of those fallbacks means *money has not been collected*. The
      customer meanwhile went through a sandbox page that charged them nothing.

**Question to answer:** if no configured payment method is available on the cart,
is the correct behaviour to fall back to "check / money order", or to refuse?
What would the shop's accountant say about a real order marked `free`?

### 1.4 · The idempotency marker is recorded before the work succeeds. This loses paid orders.

This is the sharpest pure-correctness bug in the repo.

- [ ] `storefront/src/lib/payment.ts:54-58` — `seenEvent(eventId)` adds the id to
      the set **and** returns whether it was already there, in one call.
- [ ] `storefront/src/app/api/payment-webhook/route.ts:29` calls it *before*
      attempting `placeFinalOrder`.
- [ ] `payment-webhook/route.ts:56-59` — when order placement fails, it
      deliberately returns 500 so the payment provider retries. The comment on
      line 58 says exactly that: *"Non-200 so the provider retries — the payment
      DID happen"*.
- [ ] Follow the retry. It arrives with the same `eventId`. Line 29 sees it
      already in the set, returns `200 "Already processed"`, and never reaches
      the order code again.

Result: one transient Magento failure means the customer is charged and no order
ever exists. The retry mechanism the code explicitly relies on is disabled by the
line above it.

**Question to answer:** at what point in the sequence is an event genuinely
"processed"? Write the answer down as a sentence before you change any code.

### 1.5 · Every Magento call is retried, including `placeOrder`.

- [ ] `storefront/src/lib/fetchWithProtection.ts:6` sets `RETRIES = 1`, and the
      loop at line 30 retries on any thrown error, including a timeout at
      `TIMEOUT_MS = 8_000`.
- [ ] `storefront/src/lib/magentoClient.ts:21` installs this wrapper as the fetch
      implementation for **all** GraphQL traffic. `graphql-request` sends
      mutations as POST.
- [ ] So `addProductsToCart`, `setShippingAddressesOnCart` and
      `placeOrder` (`storefront/src/lib/checkoutFinalize.ts:272`) are all subject
      to automatic retry. A response that is merely *slow* — Magento processed
      it, the reply arrived at 8.1 seconds — looks identical to a failure.
- [ ] Note that `checkoutFinalize.ts:291` contains a comment warning never to
      retry `placeOrder` because it would ship twice. The retry is happening one
      layer down, where that comment cannot see it.

**Question to answer:** which of these operations are safe to repeat blindly and
which are not? Should a retry policy be a property of the transport, or of the
individual call?

---

## Section 2 — Loses orders or money regardless of the flag

### 2.1 · The stock check silently passes when it can't identify the item.

- [ ] `storefront/src/lib/stockCheck.ts:56` — the filter is
      `inStock.get(i.sku) === false`. An SKU that is **absent** from the map is
      `undefined`, not `false`, so it is treated as available.
- [ ] The map is built only from the variants of the two parent SKUs at lines
      22-25. Anything else in the cart is unchecked.
- [ ] Now look at where `i.sku` comes from: `storefront/src/lib/cart.ts:105` uses
      `configured_variant?.sku ?? product.sku`. If Magento does not return
      `configured_variant`, this is the **parent** SKU, which is never a key in
      that map.

So the last-line-of-defence stock check in front of payment can silently become
a no-op, and it will not log anything when it does.

**Question to answer:** when a safety check cannot determine an answer, should it
pass or fail? Write down which behaviour this code currently has and which one
you want, and make the difference visible in the logs either way.

### 2.2 · Choosing "home delivery" may not change anything about the shipment.

- [ ] `storefront/src/app/afgreidsla/page.tsx:26-41` — `buildOptions()` invents
      two customer-facing options ("Dropp afhendingarstaður" and "Dropp
      heimsending") out of whatever shipping methods Magento returned, using
      heuristics: free carrier for pickup, cheapest paid for home, falling back
      to `cheapest` for both.
- [ ] If Magento returns exactly one method, `pickupMethod` and `homeMethod` are
      **the same method**. The customer picks home delivery and the order is
      created identically to a pickup order.
- [ ] The only trace of the choice that reaches the order is a free-text street
      line: `storefront/src/app/api/checkout/route.ts:74-77` appends
      `"Dropp: <name> (<id>)"` as address line 2
      (`storefront/src/lib/checkoutFinalize.ts:126-128`).

**Question to answer:** how does whoever packs the parcel tell a pickup order
from a home delivery? Trace it from the button click to something a warehouse
can read. If the answer is "a string in address line 2", say whether that is
good enough.

### 2.3 · Home delivery availability fails open.

- [ ] `storefront/src/lib/dropp.ts:63` and `:68` both return
      `{ available: true, known: false }` when Dropp's API is unreachable or
      returns nothing.
- [ ] `storefront/src/app/api/checkout/route.ts:104` only blocks when
      `home.known && !home.available`.

This is documented as deliberate — never block a sale on a third party's outage.
It is a legitimate choice, but it means orders can be accepted for postcodes
Dropp does not deliver to.

**Question to answer:** who finds out, and how, when an order is accepted for an
undeliverable postcode? Right now nothing records that the check was skipped.

### 2.4 · Town names attached to orders are wrong for large parts of the country.

- [ ] `storefront/src/lib/checkoutFinalize.ts:20-45` — the `TOWNS` table maps
      postcode *ranges* to a single town name. Several ranges are far too wide:
      `[500, 531, "Hvammstangi"]` labels Hólmavík, Drangsnes and Árneshreppur as
      Hvammstangi. `[645, 661, "Laugar"]` and `[820, 826, "Eyrarbakki"]` have the
      same problem.
- [ ] `townForPostcode()` at line 62 returns `"Reykjavík"` for anything
      unmatched, silently.
- [ ] This value is written to the shipping address in Magento
      (`checkoutFinalize.ts:129`) whenever the customer's own `city` is absent —
      and the checkout form has no city field at all
      (`afgreidsla/page.tsx:87-94`), so it is always absent.

**Question to answer:** the app already downloads the official national address
registry for validation (`storefront/src/lib/addressRegistry.ts`). Why is the
town name coming from a hand-written table instead? Answer that before deciding
whether to fix the table or the approach.

---

## Section 3 — Will break specifically on DigitalOcean

### 3.1 · There is no deployment configuration of any kind.

- [ ] No `Dockerfile`, no `.do/app.yaml`, no `Procfile`, nothing.
- [ ] The repository root has **no `package.json`**. The Next.js app lives in
      `storefront/`. DigitalOcean's buildpack detection runs at the repo root
      and will find nothing there.
- [ ] `storefront/package.json:8` — `start` is `next start`.

**Question to answer:** how does App Platform learn that the app is in a
subdirectory, and which port does `next start` listen on when DigitalOcean sets
`PORT`? Verify the second one; do not assume it.

### 3.2 · The app is only correct at exactly one instance, and nothing says so.

This is the item most likely to be broken later by someone who thinks they are
helping.

Every piece of state in this application lives in the memory of a single Node
process:

- [ ] `storefront/src/lib/payment.ts:50-52` — the processed-event set, the
      per-cart lock, and the order-result map.
- [ ] `storefront/src/lib/cache.ts:7` — the cart and product cache.
- [ ] `storefront/src/lib/errorMonitor.ts:15` — the error buffer behind
      `/kerfi/villur`.
- [ ] `storefront/src/lib/addressRegistry.ts:52` — the address index.

Consequences on App Platform specifically:

- [ ] **Two instances break order deduplication.** Two webhook deliveries landing
      on two containers each see an empty `processedEvents` set. Both place the
      order. Section 1.4's lock does not help; it is also per-process.
- [ ] **Every deploy and every restart wipes `orderResults`.** App Platform
      restarts containers on deploy and on failed health checks. A customer
      mid-checkout then polls `/api/order-status`
      (`storefront/src/app/api/order-status/route.ts:10`) and gets `unknown`
      forever — the confirmation page at
      `storefront/src/app/stadfesting/page.tsx:19` spins for 30 tries and stops.
- [ ] **Nothing is bounded.** `processedEvents` and `orderResults` are never
      pruned; `cache.ts` only evicts an entry when that exact key is read again.
      A long-running container accumulates every cart id it has ever seen.

**Question to answer:** where should state that must survive a restart actually
live? And separately: what stops someone from moving the instance-count slider
in the DigitalOcean UI six months from now?

### 3.3 · Every anonymous page view writes a new cart into Magento.

- [ ] `storefront/src/components/CartButton.tsx` sits in the root layout
      (`storefront/src/app/layout.tsx:31`), so it mounts on every page and on
      every pathname change (`CartButton.tsx:23-27`) and calls `GET /api/cart`.
- [ ] That route calls `ensureCartId()` (`storefront/src/lib/cart.ts:48-56`).
      With no cookie present, it runs a `createEmptyCart` mutation.
- [ ] So every first-time visitor creates a guest quote — including every
      crawler, every bot, every uptime check. With no rate limiting (4.4) that
      is unbounded.

Read this together with 0.1. If this points at another business's production
Magento, the app writes rows into their database on every anonymous hit, before
anyone has shown any intent to buy.

**Question to answer:** at what point in a visit should a cart come into
existence?

### 3.4 · The address registry may exhaust the container's memory.

Concrete, verified numbers:

- [ ] `storefront/src/lib/addressRegistry.ts:9-11` fetches
      `Stadfangaskra.csv`. A `HEAD` request against that URL right now returns
      `Content-Length: 38032093` — **38 MB**.
- [ ] Line 62 does `await res.text()` — the whole 38 MB becomes one JS string.
- [ ] Line 64 does `text.split(/\r?\n/)` — that string becomes an array of
      roughly a quarter of a million more strings, while the original is still
      held.
- [ ] Then lines 78-98 build nested `Map`/`Set` structures on top.

The failure sequence to watch for: deploy succeeds, homepage loads fine,
everything looks healthy — and then the **first customer to open `/afgreidsla`**
triggers `fetch("/api/address-check?warm=1")`
(`storefront/src/app/afgreidsla/page.tsx:153`), the container's memory spikes,
and it is killed. Health check fails, App Platform restarts it, and the next
customer does it again. Note also that the prefetch is not the only trigger —
the checkout POST calls `checkAddress` directly
(`storefront/src/app/api/checkout/route.ts:50`), so the first form submission
does it too.

- [ ] **Measure this rather than assume it.** Peak heap for the string, the
      split array and the maps together is plausibly fatal on a 512 MB instance
      and probably survivable on 1 GB — but that is an estimate, not a fact.
      Deploy, open `/afgreidsla` exactly once, watch the instance memory graph
      in the DigitalOcean console, and write down the peak.
- [ ] Note also that line 58 allows 60 seconds for the download, so the container
      is degraded for up to a minute either way.

- [ ] Separately: the hostname is `hmsstgsftpprodweu001...` — check whether
      `stg` in that name means you are depending on a staging system.

**Question to answer:** does a storefront need the entire national address
registry resident in its own memory to validate one address? List the
alternatives before you pick one.

### 3.5 · `NEXT_PUBLIC_*` variables must be present at build time, and fail silently if not.

- [ ] Two are used: `NEXT_PUBLIC_DROPP_STORE_ID`
      (`afgreidsla/page.tsx:68`) and `NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD`
      (`afgreidsla/page.tsx:393`).
- [ ] `NEXT_PUBLIC_` variables are inlined into the browser bundle during
      `next build`. On App Platform an environment variable scoped RUN_TIME only
      is not visible to the build, and the value compiles in as `undefined`.
- [ ] The threshold has a literal fallback of `15000` — so the site will
      confidently display a free-shipping threshold that may be wrong.
- [ ] The store id has **no fallback and no error**. The Dropp script loads
      without it and the map picker simply misbehaves. Nothing is logged.

**Question to answer:** which of this app's variables are needed at build time
and which at run time? Produce that split before you type anything into the
DigitalOcean environment editor.

### 3.6 · No Node version is pinned.

- [ ] `storefront/package.json` has no `engines` field. There is no `.nvmrc`.
- [ ] Next.js 16 has a minimum Node version. The platform will pick a default,
      and that default can change between deploys.

**Question to answer:** which Node version did you build and test against, and
where is that recorded so the platform uses the same one?

### 3.7 · The health check may be pointed at the most expensive route in the app.

- [ ] `storefront/src/app/page.tsx:7` sets `dynamic = "force-dynamic"`, so a
      request to `/` makes two live Magento calls, each allowed up to 8 seconds
      by `fetchWithProtection.ts:5`.
- [ ] If the App Platform health check targets `/`, then a slow Magento produces
      failed health checks, which produce a container restart, which produces a
      restart loop — with nothing in the logs naming Magento as the cause. That
      is precisely the failure an inexperienced operator cannot diagnose.

**Question to answer:** which path does the App Platform health check request,
and does that path make an outbound network call? Find out rather than assume;
if the answer is yes, this is a configuration item, not a code change.

---

## Section 4 — Exposure

### 4.1 · Internal error text is deliberately sent to the customer's browser.

- [ ] `storefront/src/app/api/checkout/route.ts:132` returns
      `detail: msg.slice(0, 600)` in the JSON error body, and
      `afgreidsla/page.tsx:125` renders it on the page.
- [ ] Commit `5a1656a` is literally titled *"Sýna nákvæma checkout-villu á meðan
      við kembum"* — show the exact checkout error while we debug. That debug aid
      was never removed.
- [ ] Magento GraphQL errors routinely contain endpoint URLs, internal field
      names, and stack context.

**Question to answer:** what does a customer need to see when checkout fails, and
what do *you* need to see? Where should the second one go instead?

### 4.2 · The cart id travels through the URL.

- [ ] The cart id is deliberately kept in an `httpOnly` cookie
      (`storefront/src/lib/cart.ts:57-63`) so JavaScript cannot read it.
- [ ] It is then put straight into a query string:
      `storefront/src/lib/payment.ts:42-43` builds `/sandbox-greidsla?ref=<cartId>`,
      and `stadfesting/page.tsx:21` sends it to
      `/api/order-status?ref=…`, which has no authorization check.
- [ ] URLs land in browser history, in referrer headers, and in access logs.

**Question to answer:** what was the `httpOnly` cookie protecting against, and is
that protection still intact once the same value is in the address bar? Combine
this with item 1.1 before you answer.

### 4.3 · The error dashboard is broken in production by its own auth check.

- [ ] `storefront/src/app/api/log-error/route.ts:8-12` — in production, `GET`
      requires `?token=` matching `MONITOR_TOKEN`.
- [ ] `storefront/src/app/kerfi/villur/page.tsx:16` fetches `/api/log-error` with
      no token at all.

So the dashboard shows nothing in production, permanently, and looks like there
are simply no errors. Also note `POST` on that route is unauthenticated, so
anyone can write entries into the buffer that a real error would otherwise
occupy.

**Question to answer:** is a per-process in-memory ring buffer the right place
for production errors at all? (See 3.2 — it is wiped on every deploy.)

### 4.4 · There is no rate limiting anywhere.

- [ ] `storefront/src/proxy.ts:2` says rate limiting will live there "later". It
      does not exist yet.
- [ ] The expensive unauthenticated endpoints are `/api/checkout` (six-plus
      Magento mutations per call), `/api/address-check`, and `/api/cart`.

**Question to answer:** what is the cheapest request an anonymous visitor can
send that costs your Magento the most work? Time it.

---

## Section 5 — Repository state

### 5.1 · A second, stale Third Kit site is live right now.

- [ ] `.github/workflows/deploy-pages.yml` publishes the `site/` folder to GitHub
      Pages on **every push to main**.
- [ ] `https://bennigum2005.github.io/thirdkit-repo-fresh/` currently returns
      **HTTP 200**. It is serving the old static site.
- [ ] That site still contains `const AVAILABILITY_URL = "PASTE-AVAILABILITY-URL"`
      at `site/index.html:208`.

**Question to answer:** is that URL supposed to be public? If not, it is not
enough to stop deploying it — decide what happens to the already-published site.

### 5.2 · The documentation describes an architecture that no longer exists.

- [ ] `docs/GUIDE.md` walks the reader through registering an Entra application,
      granting Business Central API permissions, and deploying an Azure Function
      App. Phase 4 tells them to edit `site/fullordins.html` and
      `site/barna.html` — **neither file exists in the repo.** Phase 5 configures
      a webhook to `/api/order`, which also does not exist (`middleware/` has
      `availability.js`, `pay.js`, `confirm.js`).
- [ ] `docs/ADMIN-CHECKLIST.md` asks a client's administrator to grant Global
      Administrator-level consent and Contributor rights on an Azure
      subscription — for infrastructure this project no longer uses.
- [ ] The root `README.md` describes the same dead structure.
- [ ] `storefront/README.md` is the untouched `create-next-app` boilerplate,
      including instructions to deploy on Vercel.

If you hand someone this repo, those documents will send them to build Azure
infrastructure for a week.

**Question to answer:** which of `middleware/`, `site/`, and the three docs
describe work that is still live, and which are history? Anything in the second
category needs to say so on its first line.

### 5.3 · There is no environment variable reference.

`storefront/src/lib/magentoClient.ts:12` tells the operator to "see
`.env.local.example`". **That file does not exist**, anywhere in the repo.

Here is the complete inventory, extracted from the source. This is a list of
names, not a configuration — you still have to determine each one's correct
value, whether it is required, and whether it is needed at build time or run
time.

```
DROPP_API_KEY                      DROPP_API_URL
DROPP_LOCATIONS_URL                MAGENTO_GRAPHQL_ENDPOINT
MAGENTO_SKU_ADULT                  MAGENTO_SKU_KIDS
MAGENTO_STORE_CODE                 MONITOR_TOKEN
NEXT_PUBLIC_DROPP_STORE_ID         NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD
PAYMENT_METHOD_CODE                PAYMENT_PROVIDER
PAYMENT_WEBHOOK_SECRET             PLACE_REAL_ORDERS
STADFANGASKRA_URL
```

Note that `PAYMENT_PROVIDER` appears only in a comment
(`storefront/src/lib/payment.ts:41`) — it is not read by any code.

- [ ] Produce a committed example file with every name, a one-line description,
      and no values.

---

## Section 6 — Minor, worth knowing

- [ ] `storefront/src/app/page.tsx:7` sets `dynamic = "force-dynamic"`, so every
      single homepage view makes two live Magento requests. There is no caching
      layer in front of it. Consider what that looks like under any real traffic
      — and see 3.7 for what it does to a health check.
- [ ] `storefront/src/app/page.tsx:11-36` — hardcoded fallback products with
      prices of 9990 and 8990 render whenever Magento is unreachable. The only
      indication is a small grey line reading "Sýnigögn". A customer can add a
      fallback product to a cart.
- [ ] `storefront/public/intro.mp4` is 3.8 MB and is served by the Node process
      on every first visit, not from a CDN.
- [ ] `storefront/src/proxy.ts:8` logs every request path to stdout. On App
      Platform that is your log bill.
- [ ] `storefront/src/lib/checkoutFinalize.ts:90-102` caches Magento's region
      list in a module-level variable forever, and the underlying query is not
      wrapped in error handling — a failure there fails the whole checkout with
      a 502.
- [ ] `storefront/src/app/api/checkout/route.ts:78` re-runs all three customer-info
      mutations on both phases of checkout, so a normal checkout sends at least
      six mutations to Magento.

---

## Section 7 — What "ready to deploy" means

Do not treat this as a to-do list to grind through. Treat it as the set of
statements that must be **true and demonstrable** before a deploy:

1. [ ] It is written down whose Magento this connects to and who authorized
       writes to it. (0.1)
2. [ ] Either a real payment provider exists in the Next.js app, or everyone
       involved knows this deployment cannot take money. (0.2)
3. [ ] No development-only route or page is reachable on the deployed site, and
       you have proven it with a request from outside. (1.1)
4. [ ] The app refuses to serve rather than run with a default payment secret. (1.2)
5. [ ] **Demonstrated, not reasoned about:** a transient Magento failure during
       order placement, followed by the provider's retry, results in the order
       existing. Force the failure, let the retry come, then find the order.
       Explaining why it currently fails is not the same as fixing it. (1.4)
6. [ ] You can explain in one sentence what happens when a request times out
       after Magento has already processed it. (1.5)

Items 7 to 9 are the three *separate* failures behind 3.2. Pinning the app to a
single instance addresses only the first of them. Do not treat that as covering
the other two.

7. [ ] Two containers cannot both place the same order — either because state is
       shared, or because the single-instance constraint is enforced somewhere a
       slider in the DigitalOcean UI cannot override. (3.2)
8. [ ] A customer who is mid-checkout when the app is redeployed still reaches a
       confirmation. Test it: start a checkout, trigger a deploy, then poll
       `/api/order-status`. (3.2)
9. [ ] The dedupe set, the order-result map and the cache are bounded, or you can
       state how large they grow over a month of traffic. (3.2)
10. [ ] A cart is not created for every anonymous visitor and bot. (3.3)
11. [ ] `/afgreidsla` has been opened on the deployed instance, the peak memory
        from the DigitalOcean graph is written down, and the container is still
        alive five minutes later. (3.4)
12. [ ] Build-time and run-time variables are separated, and the deployed page
        shows the correct free-shipping threshold. (3.5)
13. [ ] The health-check path does not depend on Magento being reachable. (3.7)
14. [ ] Customers see a customer-facing error; you see the real one somewhere
        else. (4.1)
15. [ ] There is exactly one live Third Kit site. (5.1)
16. [ ] Every document in the repo either describes the current architecture or
        says on its first line that it does not. (5.2)
17. [ ] A committed env example file lists every variable. (5.3)

`docs/PROFANIR.md` is a good functional test script and still applies — but it
tests the happy path on localhost with the sandbox provider. Nothing in it
covers a single item in Sections 1, 3, or 4. It is not a deployment gate.
