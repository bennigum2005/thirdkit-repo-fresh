# Third Kit — what to fix before deploying

**Repo:** `thirdkit-repo-fresh` @ `b134b74` · **Deploying to:** DigitalOcean App Platform · **Reviewed:** 2026-08-18

## How to read this

Each item is: **what's wrong**, **where it is** (file and line), and **a question you
have to answer**. The answers aren't written out. That's on purpose — these sit on
the path that takes money from customers, and you need to be able to explain each
fix to someone else before it goes live.

**What I checked:** the whole of `storefront/`, `middleware/`, `docs/` and the CI
workflow. I ran the type checker and the production build — both pass, zero errors.
I also made live requests to Dropp, to the address registry, and to your GitHub
Pages URL.

**What I did not check:** nothing was run against a real Magento. So treat the
reasoning as solid and the exact runtime behaviour as unconfirmed.

**Important:** the build passing tells you nothing here. Every problem below is a
runtime, configuration or design problem. A compiler cannot see any of them.

**Ticking things off.** Every `- [ ]` below is yours to fill in. Change it to `- [x]`
and commit. GitHub won't let you click them in a file view — you edit the file — and
that's fine, because the commit is the record of when you did it and the diff shows
what you wrote next to it. Section 7 at the end is the separate list of things that
must be *proven* before deploying; those are ticked last.

A few words used throughout:

- **webhook** — the payment provider's server calling your server to say "this was paid".
- **idempotent** — safe to run twice and still get one result.
- **instance / container** — one running copy of your app. DigitalOcean can run several.
- **env var** — a setting you type into the DigitalOcean dashboard, not into the code.

---

## The reference: joi_web already solves most of this

Third Kit is going to run Verifone and Dropp, the same as `joiweb/joi_web`. That is
a live Next.js storefront on headless Magento with both already working. Almost
every problem below has already been answered there — in production, against real
money.

Read the note first, then the files the note points at. Don't grep the repo blind.

- [ ] Read `joi_web/docs/obsidian/Home.md`
- [ ] Read `payments/Verifone 3DS.md`, and the routes it names
- [ ] Read `payments/Dropp Delivery.md`, and `src/lib/dropp.ts`
- [ ] Read `commerce/Cart & Checkout.md` — the shared order-creation path both use

| Problem here | Where joi_web answers it |
|---|---|
| 0.2 no payment provider | Three-leg flow: `api/verifone/payment/` → hosted page → `api/verifone/webhook/` |
| 1.2 shared static secret | Webhook verifies a JWS signature against `VERIFONE_JWKS_URL`. No shared secret to leak. |
| 1.4 order lost on retry | Dedupe key, a short-lived lock, and a completion key checked *before* creating the order — see "Idempotency & race conditions" in the Verifone note |
| 2.2 Dropp pickup vs home | `setDroppOnCartIfApplicable()` in `src/lib/checkoutFinalize.ts:839` writes the pickup ID onto the cart. Not a free-text address line. |
| 3.2 state in one process | All of it lives in Valkey (a shared key-value store), not process memory — which is why extra copies of the app are safe there and not here |

Two things to keep in mind while reading it. joi_web is Next.js 15 and this is
Next 16, so some conventions differ. And its Verifone integration has hard-won
quirks — snake_case field names, names truncated to 22 characters — that are written
down in the note precisely because they cost days to find. Read those before you
write any Verifone code.

- [ ] **Before fixing anything in section 1, read both notes and write down which of
these five you're porting and which you're solving differently, and why.**

---

## 0 — Stop here first

Three questions. Nothing below matters until they're answered.

### 0.1 · Production Magento or a test one?

`MAGENTO_GRAPHQL_ENDPOINT` decides which Magento this talks to, and there is no test
instance configured anywhere in the repo. `stockCheck.ts:23-25` has `TK01F` and
`TK02B` written straight into the code.

So the default path is: deploy, point it at production, and every cart, address and
order this app creates goes into the live shop — including everything you break
while testing.

- [ ] **Is there a staging Magento? If not, how do you test sections 1 to 4 without
filling the live shop with junk carts and test orders?**

Do not go past this line until you can answer that.

### 0.2 · This app cannot take money yet

`payment.ts:36-44` — the function that's supposed to start a payment ignores the
amount entirely and sends the customer to `/sandbox-greidsla`, which is a fake
payment page inside your own app. There is no real payment provider in the Next.js
storefront.

The Verifone code you wrote is in `middleware/src/verifone.js`. That's the old Azure
Functions project. It does not deploy to DigitalOcean and nothing in the storefront
calls it.

Verifone and Dropp are both coming, and joi_web already runs both — see the
reference section below. That makes this unfinished work, not a deployment step.

- [ ] **Until Verifone is wired in, is this a test site that deliberately can't charge
anyone? Who makes sure no customer-facing domain points at it before then?**

### 0.3 · What does `PLACE_REAL_ORDERS` do?

`payment-webhook/route.ts:39-43` — while that env var is not `true`, the webhook
pretends the order was placed and never touches Magento. Everything in Section 1
below is harmless while it's off, and all of it goes live the moment it's on.

- [ ] **Who is allowed to set it, and what has to be working before they do?**

---

## 1 — These all go live together with `PLACE_REAL_ORDERS=true`

### 1.1 · Anyone on the internet can place a free order

`sandbox-complete/route.ts` has no check for whether it's running in production.
Compare it with `villa-test/route.ts:5-7`, which does have one and returns 404. The
`/sandbox-greidsla` page has no check either.

Here's what a stranger can do to the deployed site:

1. `GET /api/cart` — the response includes the cart's `id` (`cart.ts:102`).
2. Add items normally.
3. `POST /api/sandbox-complete` with that cart id.
4. **Your own server** then signs a "this was paid" message with its own secret
   key (`sandbox-complete:18`) and sends it to your webhook.
5. The signature checks out, because your server is the one that made it.

Order placed. Nothing paid.

Try it yourself before you accept this. You'll need a `.env.local` with a working
`MAGENTO_GRAPHQL_ENDPOINT` (step 1 creates a real cart, so it can't run without
one), and leave `PLACE_REAL_ORDERS` unset so it stops at the pretend branch.

- [ ] **Which routes and pages are only meant for development, and what actually stops
them being reachable in production? Right now: one route checks, the others don't.**

### 1.2 · The payment secret has a working fallback

`payment.ts:12-19` — if `PAYMENT_WEBHOOK_SECRET` isn't set, the code logs a warning
and uses the text `"dev-only-secret-change-me"` instead. That string is in this
public repo, so anyone can read it and forge a payment message.

A warning in a log file is not protection. Nobody reads logs until something breaks.

- [ ] **When the payment secret is missing, should the app warn and carry on, or refuse
to start? Which of those do you want the forgetful person to get?**

### 1.3 · `/api/pay` will accept a payment method that means "not paid"

`pay/route.ts:28-31` tries your configured method first, then falls through to
`checkmo`, `banktransfer`, `cashondelivery`, `free` and `purchaseorder`. It takes
whichever Magento offers first.

Every one of those means the money has not been collected. Meanwhile the customer
went through a sandbox page that charged them nothing.

- [ ] **If no proper payment method is available on the cart, should it fall back to
"cheque in the post", or refuse? What would the shop's accountant say to a real
order marked `free`?**

### 1.4 · A paid order can be lost forever — the worst bug here

`payment.ts:54-58` — `seenEvent()` both records the event id *and* tells you whether
it had seen it before, in one step.

`payment-webhook/route.ts:29` calls it **before** trying to place the order.

Then `payment-webhook/route.ts:56-59` — if placing the order fails, it returns a 500
on purpose, so the payment provider will try again. The comment says exactly that.

Now follow the retry. It arrives with the same event id. Line 29 has already
recorded it, so it answers "already processed", returns 200, and never gets near the
order code again.

Result: the customer is charged, no order is ever created, and the retry mechanism
the code is counting on has been switched off by the line above it.

- [ ] **At what point is an event genuinely "done"? Write that as one sentence before
you change any code.**

### 1.5 · Every Magento call is retried, including placing the order

`fetchWithProtection.ts:6` retries once, after an 8-second timeout.
`magentoClient.ts:21` applies that to *all* Magento traffic, and GraphQL sends
everything as POST — including `placeOrder`.

A response that is merely slow (Magento did the work, the reply came back at 8.1
seconds) looks exactly like a failure. So it gets sent again.

`checkoutFinalize.ts:291` has a comment warning never to retry `placeOrder` because
it would ship twice. The retry is happening one layer below, where that comment
can't see it.

- [ ] **Which of these calls are safe to repeat blindly? Should "retry" be a property of
the connection, or of each individual call?**

---

## 2 — Wrong regardless of that flag

### 2.1 · The stock check quietly passes when it can't find the item

`stockCheck.ts:56` looks for `=== false`. An SKU that isn't in the list at all comes
back as `undefined`, which is not `false` — so it counts as in stock.

The list is only built from the two parent SKUs (`stockCheck.ts:22-25`). And
`cart.ts:105` sometimes uses the **parent** SKU, which is never in that list.

So your last check before taking money can silently do nothing at all, and it won't
log a thing when it does.

- [ ] **When a safety check can't work out the answer, should it pass or fail? Which
does this one do right now?**

### 2.2 · Picking "heimsending" may not change the delivery at all

`afgreidsla/page.tsx:26-41` invents the two customer-facing options by guessing from
whatever Magento returned: free carrier becomes pickup, cheapest paid becomes home.
If Magento returns only one method, **both options are the same method**. The
customer picks home delivery and the order comes out identical to a pickup order.

The only record of the choice is a line of free text stuck on the address
(`checkout/route.ts:74-77`, `checkoutFinalize.ts:126-128`).

joi_web does this properly — the pickup ID goes onto the cart itself
(`setDroppOnCartIfApplicable()`), and Dropp gets a real booking through their API.

- [ ] **How does the person packing the parcel tell the two apart? Follow it from the
button click to something a warehouse can actually read. Then compare with how
joi_web does it.**

### 2.3 · Home delivery is allowed when Dropp can't be reached

`dropp.ts:63` and `:68` both answer "available" when Dropp's API is down, and
`checkout/route.ts:104` only blocks when Dropp positively said no. This is a
deliberate choice — don't lose sales over someone else's outage — but it means
orders get accepted for postcodes Dropp doesn't deliver to, and nothing anywhere
records that the check was skipped.

- [ ] **Who finds out that it happened, and how?**

### 2.4 · The town on the order is wrong for a lot of the country

`checkoutFinalize.ts:20-45` maps ranges of postcodes to one town each, and several
ranges are far too wide. `[500,531,"Hvammstangi"]` labels Hólmavík, Drangsnes and
Árneshreppur as Hvammstangi. Same problem with `[645,661,"Laugar"]` and
`[820,826,"Eyrarbakki"]`. Anything unmatched silently becomes `"Reykjavík"` (`:62`).

This is always used, because the checkout form has no town field at all.

- [ ] **The app already downloads the official national address registry to validate
addresses. Why is the town coming from a hand-typed table instead?**

---

## 3 — Problems specific to DigitalOcean

### 3.1 · There's no deployment configuration at all

No `Dockerfile`, no `.do/app.yaml`, no `Procfile`. And the top level of the repo has
**no `package.json`** — the app lives in `storefront/`. DigitalOcean looks at the top
level to work out what kind of app this is, and will find nothing.

- [ ] **How do you tell App Platform the app is in a subfolder? And which port does
`next start` listen on when DigitalOcean sets `PORT`? Check that one — don't assume.**

### 3.2 · The app is only correct with exactly one copy running, and nothing says so

Everything the app remembers lives in the memory of a single running process:
`payment.ts:50-52` (which payments it has handled, the locks, the order results),
`cache.ts:7`, `errorMonitor.ts:15`, `addressRegistry.ts:52`.

That causes three different problems:

- **Two copies running:** a webhook arriving twice can land on two different copies.
  Neither knows about the other. Both place the order. The lock doesn't help — it's
  also per-copy.
- **Every deploy and restart:** the order results are wiped. A customer who was
  mid-checkout polls `/api/order-status`, gets "unknown" forever, and the
  confirmation page (`stadfesting/page.tsx:19`) gives up after 30 tries.
- **Nothing is ever cleaned up:** the list of handled payments and the order results
  only grow. A copy that runs for weeks holds every cart id it has ever seen.

- [ ] **Where should information that must survive a restart actually live? And
separately — what stops someone dragging the instance-count slider in the
DigitalOcean dashboard six months from now?**

### 3.3 · Every anonymous visitor creates a cart in Magento

The cart button is in the site-wide layout (`layout.tsx:31`), so it runs on every
page and every navigation (`CartButton.tsx:23-27`) and calls `GET /api/cart`. That
calls `ensureCartId()`, which — with no cookie yet — creates a brand-new cart in
Magento (`cart.ts:48-56`).

Every first-time visitor. Every Google crawler. Every uptime checker. And there's no
rate limiting (4.4), so there's no ceiling on it. Magento's quote tables grow on
every one of them, and it's the live shop taking that (0.1).

- [ ] **At what point in a visit should a cart come into existence?**

### 3.4 · The address registry may kill the container

`addressRegistry.ts:9-11` downloads `Stadfangaskra.csv`. I checked it: it is
**38,032,093 bytes — 38 MB**. Line 62 loads all of it into memory as one piece of
text. Line 64 splits that into roughly a quarter of a million pieces, while still
holding the original. Lines 78-98 then build lookup tables on top of both.

Expect this sequence: the deploy succeeds, the homepage works, everything looks
healthy — and then the **first customer who opens `/afgreidsla`** sets it off
(`afgreidsla/page.tsx:153`), memory spikes, the container is killed, DigitalOcean
restarts it, and the next customer does it again. Submitting the form triggers it
too (`checkout/route.ts:50`), so the prefetch isn't the only route in. And line 58
allows 60 seconds for the download, so it's degraded for up to a minute first.

- [ ] **Measure this, don't guess: deploy, open `/afgreidsla` once, and write down the
peak memory from the DigitalOcean graph. Then ask whether a shop needs the entire
national address registry sitting in its own memory.**

### 3.5 · `NEXT_PUBLIC_` variables must exist when you build, and fail silently if not

Two are used, both in `afgreidsla/page.tsx` (lines 68 and 393). Anything starting
`NEXT_PUBLIC_` gets baked into the browser code during `next build` — so a variable
that DigitalOcean only provides at *run* time is baked in as `undefined`.

Nothing crashes. The free-shipping threshold falls back to `15000`, so the site
confidently shows a number that may be wrong. The Dropp store id has no fallback and
logs nothing at all — the map picker just misbehaves.

- [ ] **Which of your settings are needed when building, and which when running? Work
that out before you type anything into the DigitalOcean environment editor.**

### 3.6 · No Node version is pinned

No `engines` in `package.json`, no `.nvmrc`. Next.js 16 has a minimum version, and
the platform default can change between one deploy and the next.

- [ ] **Which Node version did you build and test on, and where is that written down so
the platform uses the same one?**

### 3.7 · The health check may be hitting your slowest page

`page.tsx:7` marks the homepage as always-dynamic, so every request to `/` makes two
live Magento calls, each allowed up to 8 seconds.

If DigitalOcean's health check points at `/`, then a slow Magento means failed health
checks, which means the container gets restarted, over and over — and nothing in the
logs will say "Magento". That's exactly the kind of failure that's impossible to
diagnose if you haven't seen it before.

- [ ] **Which path does the health check request, and does that path make an outside
network call? Find out rather than assume — if yes, it's a settings change, not a
code change.**

---

## 4 — Things that leak

### 4.1 · Customers are shown your internal error messages

`checkout/route.ts:132` puts the raw error text into the response, and
`afgreidsla/page.tsx:125` displays it on the page. Commit `5a1656a` is called *"Sýna
nákvæma checkout-villu á meðan við kembum"* — you added it to debug, and it was never
taken out. Magento errors routinely contain endpoint URLs and internal field names.

- [ ] **What does a customer need to see when checkout fails, and what do you need to
see? Where should the second one go instead?**

### 4.2 · The cart id ends up in the address bar

The cart id is deliberately kept in a cookie JavaScript can't read (`cart.ts:57-63`)
— and then put straight into a URL by `payment.ts:42-43`, and sent to
`/api/order-status?ref=…` (`stadfesting:21`), which has no access check. URLs end up
in browser history, in referrer headers and in server logs.

- [ ] **What was that cookie protecting against, and is it still protected once the same
value is in the address bar? Answer this together with 1.1.**

### 4.3 · The error dashboard is broken by its own security check

`log-error/route.ts:8-12` requires a token in production. `kerfi/villur/page.tsx:16`
never sends one. So in production the dashboard is permanently empty — and an empty
dashboard looks exactly like "no errors". Meanwhile anyone can write into it, because
the POST side has no check at all.

- [ ] **Is a list held in one process's memory the right place for production errors?
(See 3.2 — it's wiped on every deploy.)**

### 4.4 · Nothing is rate limited

`proxy.ts:2` says rate limiting will go there "later". It doesn't exist. The
expensive endpoints anyone can call are `/api/checkout` (six or more Magento
operations per call), `/api/address-check` and `/api/cart`.

- [ ] **What's the cheapest request a stranger can send that costs your Magento the most
work? Time it.**

---

## 5 — The repo itself

### 5.1 · There is a second, out-of-date Third Kit site live right now

`.github/workflows/deploy-pages.yml` publishes the old `site/` folder to GitHub Pages
on **every push to main**. I checked:
`https://bennigum2005.github.io/thirdkit-repo-fresh/` returns **HTTP 200**. It's
still serving the old static site, which still contains
`AVAILABILITY_URL = "PASTE-AVAILABILITY-URL"` (`site/index.html:208`).

- [ ] **Is that URL supposed to be public? Turning the workflow off doesn't remove what's
already published.**

### 5.2 · The documentation describes a system that no longer exists

`docs/GUIDE.md` walks the reader through registering an app in Microsoft Entra,
granting Business Central permissions, and deploying an Azure Function App. Its
Phase 4 tells them to edit `site/fullordins.html` and `site/barna.html` — **neither
file is in the repo**. Phase 5 sets up a webhook to `/api/order`, which doesn't
exist either.

`docs/ADMIN-CHECKLIST.md` asks a client's administrator for Global Administrator
consent and Azure access — for infrastructure this project no longer uses. The root
`README.md` describes the same dead structure. `storefront/README.md` is the
untouched `create-next-app` boilerplate, telling you to deploy on Vercel.

Hand this repo to someone and those documents will send them off building Azure
infrastructure for a week.

- [ ] **Which of `middleware/`, `site/` and those three documents are still real, and
which are history? Anything in the second group needs to say so on its first line.**

### 5.3 · There's no list of settings anywhere

`magentoClient.ts:12` tells the operator to see `.env.local.example`. That file does
not exist anywhere in the repo.

Here is the full list, pulled out of the source. These are names only — you still
have to work out each one's value, whether it's required, and whether it's needed at
build time or run time:

```
DROPP_API_KEY               DROPP_API_URL              DROPP_LOCATIONS_URL
MAGENTO_GRAPHQL_ENDPOINT    MAGENTO_SKU_ADULT          MAGENTO_SKU_KIDS
MAGENTO_STORE_CODE          MONITOR_TOKEN              PAYMENT_METHOD_CODE
PAYMENT_WEBHOOK_SECRET      PLACE_REAL_ORDERS          STADFANGASKRA_URL
NEXT_PUBLIC_DROPP_STORE_ID  NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD
```

`PAYMENT_PROVIDER` only appears in a comment (`payment.ts:41`). No code reads it.

---

## 6 — Smaller things

- `page.tsx:11-36` — when Magento is unreachable, made-up products at 9990 and 8990
  are shown instead. The only hint is a small grey "Sýnigögn" line, and a customer
  can put them in a cart.
- `public/intro.mp4` is 3.8 MB and is served by your Node process on every first
  visit, not from a CDN.
- `proxy.ts:8` writes every request path to the log. On App Platform that's your bill.
- `checkoutFinalize.ts:90-102` caches Magento's region list forever in a variable,
  with no error handling — one failure there breaks the whole checkout with a 502.
- `checkout/route.ts:78` repeats all three customer-info operations on both steps of
  checkout, so a normal checkout sends six or more operations to Magento.

---

## 7 — What has to be true before you deploy

Not a to-do list to grind through. These are statements that must be true *and that
you can show someone*.

1. [ ] There's somewhere to test that isn't the live shop — or a written decision that live is acceptable. (0.1)
2. [ ] Either a real payment provider exists, or everyone involved knows this can't take money. (0.2)
3. [ ] No development-only route or page is reachable on the live site, and you proved it from outside. (1.1)
4. [ ] The app refuses to start rather than run with the fallback payment secret. (1.2)
5. [ ] **Shown, not explained:** make order placement fail once, let the retry arrive, then go and find the order. (1.4)
6. [ ] You can say in one sentence what happens when a request times out after Magento already did the work. (1.5)

*7 to 9 are the three separate problems in 3.2. Running one copy only fixes the first.*

7. [ ] Two copies of the app cannot both place the same order. (3.2)
8. [ ] A customer mid-checkout during a deploy still gets a confirmation. Test it. (3.2)
9. [ ] The stored payment ids and order results are cleaned up — or you can say how big they get in a month. (3.2)
10. [ ] Anonymous visitors and bots no longer create carts. (3.3)
11. [ ] `/afgreidsla` has been opened on the live instance, peak memory is written down, and the container is still up five minutes later. (3.4)
12. [ ] Build-time and run-time settings are separated, and the live page shows the right free-shipping number. (3.5)
13. [ ] The health check doesn't depend on Magento being up. (3.7)
14. [ ] Customers see a customer-friendly error; you see the real one somewhere else. (4.1)
15. [ ] There is exactly one live Third Kit site. (5.1)
16. [ ] Every document either describes the current system or says on its first line that it doesn't. (5.2)
17. [ ] There's a committed example settings file listing every variable. (5.3)

`docs/PROFANIR.md` is a good test script and still worth running — but it tests the
happy path, on your own machine, against the fake payment page. It doesn't touch a
single item in sections 1, 3 or 4. It is not a deployment gate.
