# Third Kit — fix list before deploying

**Repo:** `thirdkit-repo-fresh` · **Deploying to:** DigitalOcean App Platform · **Reviewed:** 2026-08-18

## How this works

30 problems. Each one says **what's wrong**, **where**, and **what you have to do**.

The fixes are not written out. You have to work them out and be able to explain them.
Several of these are on the path that takes money from customers, so "it seems to
work" is not good enough.

Tick a box by changing `- [ ]` to `- [x]` and committing. The commit is the record.

I read all of `storefront/`, `middleware/` and `docs/`, ran the type checker and the
production build (both pass, zero errors), and made live requests to Dropp, the
address registry and your GitHub Pages URL. Nothing was run against a real Magento.

**The build passing means nothing here.** Every problem below is a runtime, settings
or design problem. A compiler cannot see any of them.

Words used below:

- **webhook** — the payment provider's server calling your server to say "this was paid"
- **instance** — one running copy of your app; DigitalOcean can run several
- **env var** — a setting typed into the DigitalOcean dashboard, not into the code

---

## Part A — Answer these first

Nothing else matters until these three are settled.

**A1 · There is no test Magento**
`MAGENTO_GRAPHQL_ENDPOINT` picks the Magento. No test instance is configured
anywhere. So the default is: deploy, point at production, and every cart, address
and order goes into the live shop — including everything you break while testing.

- [ ] Say where you will test. If the answer is "production", say who agreed to that.

**A2 · The app cannot take money**
`payment.ts:36-44` — the function that starts a payment ignores the amount and sends
the customer to `/sandbox-greidsla`, a fake payment page inside your own app. Your
Verifone code is in `middleware/src/verifone.js`, which belongs to the old Azure
project, doesn't deploy to DigitalOcean, and is never called.

- [ ] Write down whether this deploy is a test site that deliberately can't charge
  anyone — and who makes sure no real domain points at it.

**A3 · `PLACE_REAL_ORDERS` is the switch**
`payment-webhook/route.ts:39-43` — while it's not `true`, the webhook fakes the
order and never touches Magento. Everything in Part B is harmless until it's on, and
all of it goes live at once when it is.

- [ ] Decide who may set it, and what must be working first.

---

## Part B — Money bugs (live once `PLACE_REAL_ORDERS=true`)

**B1 · Anyone can place a free order**
`sandbox-complete/route.ts` never checks whether it's in production.
`villa-test/route.ts:5-7` does check — copy nothing, just notice the difference.

A stranger can: call `GET /api/cart` (the reply contains the cart `id`,
`cart.ts:102`) → add items → `POST /api/sandbox-complete` with that id → **your own
server** signs a "paid" message with its own key (`sandbox-complete:18`) and sends
it to your webhook. Signature valid, because your server made it. Order placed,
nothing paid.

- [ ] Do this yourself locally and confirm it works. Leave `PLACE_REAL_ORDERS` unset.
- [ ] List every route and page that is development-only, and say what stops each
  one being reachable in production.

**B2 · The payment secret has a working fallback**
`payment.ts:12-19` — if `PAYMENT_WEBHOOK_SECRET` is missing, it logs a warning and
uses `"dev-only-secret-change-me"` instead. That text is in this public repo, so
anyone can read it and forge a payment message. A warning in a log is not protection.

- [ ] Decide: warn and carry on, or refuse to start? Then make it do that.

**B3 · `/api/pay` accepts payment methods that mean "not paid"**
`pay/route.ts:28-31` falls back through `checkmo`, `banktransfer`, `cashondelivery`,
`free`, `purchaseorder`. Every one of those means no money was collected.

- [ ] Decide what should happen when no real payment method is available, and change it.

**B4 · A paid order can be lost forever — worst bug here**
`payment.ts:54-58` — `seenEvent()` records the event id *and* reports whether it had
seen it, in one step. `payment-webhook/route.ts:29` calls it **before** placing the
order. Then lines 56-59 return a 500 on purpose so the provider retries.

Follow the retry: same event id → line 29 says "already processed" → returns 200 →
never reaches the order code. Customer charged, no order, ever. The retry the code
depends on is switched off by the line above it.

- [ ] Write one sentence saying when an event is genuinely "done". Then fix the order.
- [ ] Prove it: make placing fail once, let the retry arrive, then find the order.

**B5 · Every Magento call is retried, including placing the order**
`fetchWithProtection.ts:6` retries once after an 8-second timeout, and
`magentoClient.ts:21` applies that to everything. A slow-but-successful response
(Magento did the work, reply arrived at 8.1s) looks exactly like a failure, so it
gets sent again. `checkoutFinalize.ts:291` warns never to retry `placeOrder` — the
retry is one layer below where that comment can see it.

- [ ] List which calls are safe to repeat and which aren't, then stop retrying the
  ones that aren't.

---

## Part C — Will break on DigitalOcean

**C1 · There is no deployment config**
No `Dockerfile`, no `.do/app.yaml`, no `Procfile`. The top of the repo has **no
`package.json`** — the app is in `storefront/`, and DigitalOcean looks at the top.

- [ ] Make App Platform find the app.
- [ ] Check which port `next start` listens on when DigitalOcean sets `PORT`. Don't assume.

**C2 · The app only works with exactly one copy running**
Everything the app remembers is in one process's memory: `payment.ts:50-52` (handled
payments, locks, order results), `cache.ts:7`, `errorMonitor.ts:15`,
`addressRegistry.ts:52`. Three separate problems:

- Two instances: a webhook arriving twice can hit both. Neither knows about the
  other, both place the order. The lock is also per-instance, so it doesn't help.
- Every deploy or restart wipes the order results. A customer mid-checkout polls
  `/api/order-status`, gets "unknown" forever, and the page gives up after 30 tries.
- Nothing is ever cleaned up. A long-running instance holds every cart id it has seen.

- [ ] Move anything that must survive a restart out of process memory.
- [ ] Say what stops someone dragging the instance slider up later.

**C3 · Every anonymous visitor creates a cart in Magento**
The cart button is in the site-wide layout (`layout.tsx:31`), so it runs on every
page and navigation (`CartButton.tsx:23-27`) and calls `GET /api/cart`, which creates
a new Magento cart when there's no cookie yet (`cart.ts:48-56`). Every visitor, every
crawler, every uptime check. No rate limiting, so no ceiling.

- [ ] Decide at what point in a visit a cart should exist, and make it so.

**C4 · The address registry may kill the container**
`addressRegistry.ts:9-11` downloads `Stadfangaskra.csv`. I checked it:
**38,032,093 bytes — 38 MB**. Line 62 loads all of it as one piece of text, line 64
splits it into ~250,000 pieces while still holding the original, lines 78-98 build
lookup tables on top.

Expect: deploy fine, homepage fine, then the **first customer to open `/afgreidsla`**
sets it off (`afgreidsla/page.tsx:153`), memory spikes, container killed, restart,
next customer does it again. Submitting the form triggers it too
(`checkout/route.ts:50`).

- [ ] Deploy, open `/afgreidsla` once, write down the peak memory from the
  DigitalOcean graph.
- [ ] Decide whether a shop needs the whole national registry in its own memory.

**C5 · `NEXT_PUBLIC_` settings must exist at build time**
Used at `afgreidsla/page.tsx:68` and `:393`. Anything named `NEXT_PUBLIC_` is baked
into the browser code during the build, so a setting DigitalOcean only supplies at
run time becomes `undefined`. Nothing crashes: the free-shipping number silently
falls back to `15000`, and the Dropp store id silently becomes nothing.

- [ ] Split your settings into build-time and run-time before touching the
  DigitalOcean dashboard.

**C6 · No Node version is pinned**
No `engines` in `package.json`, no `.nvmrc`. Next.js 16 has a minimum, and the
platform default can change between deploys.

- [ ] Pin the version you tested on.

**C7 · The health check may hit your slowest page**
`page.tsx:7` marks the homepage always-dynamic, so every request to `/` makes two
live Magento calls, up to 8 seconds each. If the health check points at `/`, a slow
Magento means failed checks, restart, repeat — and nothing in the logs says "Magento".

- [ ] Find out which path the health check hits and whether it calls out to Magento.

---

## Part D — Things that leak

**D1 · Customers see your internal errors**
`checkout/route.ts:132` puts raw error text in the response and
`afgreidsla/page.tsx:125` shows it on the page. Commit `5a1656a` added it for
debugging and it was never removed. Magento errors contain endpoint URLs and
internal field names.

- [ ] Send the customer a friendly message and the real error somewhere only you see.

**D2 · The cart id ends up in the address bar**
It's kept in a cookie JavaScript can't read (`cart.ts:57-63`), then put straight into
a URL by `payment.ts:42-43` and sent to `/api/order-status?ref=…`
(`stadfesting:21`), which has no access check. URLs land in history, referrers and
server logs. Read this with B1.

- [ ] Decide what the cookie was protecting, and whether it still is.

**D3 · The error dashboard is broken by its own check**
`log-error/route.ts:8-12` requires a token in production; `kerfi/villur/page.tsx:16`
never sends one. So it's permanently empty in production — which looks exactly like
"no errors". The POST side has no check at all, so anyone can write into it.

- [ ] Fix or remove it. An empty dashboard that looks healthy is worse than none.

**D4 · Nothing is rate limited**
`proxy.ts:2` says rate limiting goes there "later". It doesn't exist. The expensive
open endpoints are `/api/checkout` (6+ Magento operations per call),
`/api/address-check` and `/api/cart`.

- [ ] Time the cheapest request that costs Magento the most, then decide a limit.

---

## Part E — Wrong data on orders

**E1 · The stock check silently passes when it can't find the item**
`stockCheck.ts:56` looks for `=== false`. An SKU that isn't in the list is
`undefined`, which counts as in stock. The list only covers the two parent SKUs
(`:22-25`), and `cart.ts:105` sometimes uses the parent SKU, which is never in it.
Your last check before taking money can do nothing at all, silently.

- [ ] Make it fail, not pass, when it can't tell. And log it when that happens.

**E2 · Picking "heimsending" may not change the delivery**
`afgreidsla/page.tsx:26-41` guesses the two options from whatever Magento returned.
If Magento returns one method, both options are the same method — home delivery
comes out identical to pickup. The only record of the choice is free text stuck on
the address (`checkout/route.ts:74-77`, `checkoutFinalize.ts:126-128`).

- [ ] Follow it from the button to something a warehouse can read. Fix the gap.

**E3 · Home delivery is allowed when Dropp is unreachable**
`dropp.ts:63` and `:68` answer "available" when Dropp is down, and
`checkout/route.ts:104` only blocks on a definite no. Deliberate — but orders get
accepted for postcodes Dropp doesn't serve and nothing records it.

- [ ] Decide if that's right. If it is, record when the check was skipped.

**E4 · The town on the order is wrong for much of the country**
`checkoutFinalize.ts:20-45` maps postcode ranges to one town each, far too widely.
`[500,531,"Hvammstangi"]` labels Hólmavík and Árneshreppur as Hvammstangi; same with
`[645,661,"Laugar"]` and `[820,826,"Eyrarbakki"]`. Anything unmatched silently
becomes `"Reykjavík"` (`:62`). Always used, because the form has no town field.

- [ ] The app already downloads the official address registry. Use it, or fix the table.

---

## Part F — Repo cleanup

**F1 · A second, out-of-date Third Kit site is live right now**
`.github/workflows/deploy-pages.yml` publishes the old `site/` folder to GitHub Pages
on **every push to main**. `https://bennigum2005.github.io/thirdkit-repo-fresh/`
returns **HTTP 200** today and still contains
`AVAILABILITY_URL = "PASTE-AVAILABILITY-URL"` (`site/index.html:208`).

- [ ] Decide if that should be public. Turning the workflow off doesn't unpublish it.

**F2 · The docs describe a system that no longer exists**
`docs/GUIDE.md` walks through Microsoft Entra, Business Central permissions and an
Azure Function App. Its Phase 4 edits `site/fullordins.html` and `site/barna.html` —
**neither file exists**. Phase 5 sets up a webhook to `/api/order`, which also
doesn't exist. `docs/ADMIN-CHECKLIST.md` asks an admin for Global Administrator
consent for that dead setup. The root `README.md` describes the same.
`storefront/README.md` is untouched boilerplate telling you to deploy on Vercel.

- [ ] Mark every dead document as dead, on its first line. Someone will follow them
  otherwise and lose a week.

**F3 · There's no list of settings**
`magentoClient.ts:12` points at `.env.local.example`, which doesn't exist. Here are
the names, pulled from the source — you work out the values:

```
DROPP_API_KEY               DROPP_API_URL              DROPP_LOCATIONS_URL
MAGENTO_GRAPHQL_ENDPOINT    MAGENTO_SKU_ADULT          MAGENTO_SKU_KIDS
MAGENTO_STORE_CODE          MONITOR_TOKEN              PAYMENT_METHOD_CODE
PAYMENT_WEBHOOK_SECRET      PLACE_REAL_ORDERS          STADFANGASKRA_URL
NEXT_PUBLIC_DROPP_STORE_ID  NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD
```

`PAYMENT_PROVIDER` only appears in a comment (`payment.ts:41`). No code reads it.

- [ ] Commit an example file listing all of them, with no values in it.

---

## Part G — Smaller

- [ ] `page.tsx:11-36` — when Magento is unreachable, made-up products at 9990 and
  8990 are shown and can be added to a cart. The only hint is a small grey line.
- [ ] `public/intro.mp4` is 3.8 MB, served by your Node process on first visit.
- [ ] `proxy.ts:8` logs every request path. On App Platform that's your bill.
- [ ] `checkoutFinalize.ts:90-102` caches Magento's region list forever with no error
  handling — one failure there 502s the whole checkout.
- [ ] `checkout/route.ts:78` repeats all three customer-info operations on both
  checkout steps, so one checkout sends six or more.

---

## Before you deploy

All of these must be true **and you must be able to show someone**:

- [ ] There's somewhere to test that isn't the live shop, or a written decision. (A1)
- [ ] Everyone knows whether this can take money. (A2)
- [ ] No development-only route is reachable on the live site, proven from outside. (B1)
- [ ] The app won't run with the fallback payment secret. (B2)
- [ ] You forced a failed order placement, the retry arrived, and the order exists. (B4)
- [ ] Two instances can't both place the same order. (C2)
- [ ] A customer mid-checkout during a deploy still gets a confirmation. (C2)
- [ ] Anonymous visitors and bots don't create carts. (C3)
- [ ] `/afgreidsla` was opened live, peak memory written down, container still up. (C4)
- [ ] The live page shows the right free-shipping number. (C5)
- [ ] The health check doesn't depend on Magento. (C7)
- [ ] Customers see a friendly error; you see the real one elsewhere. (D1)
- [ ] There's exactly one live Third Kit site. (F1)
- [ ] Dead documents say so on line 1. (F2)
- [ ] An example settings file is committed. (F3)

`docs/PROFANIR.md` is still worth running, but it only tests the happy path on your
own machine against the fake payment page. It touches nothing in Parts B, C or D. It
is not a deployment gate.
