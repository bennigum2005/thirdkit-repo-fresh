# Third Kit ↔ Business Central — Setup Guide

This connects the Third Kit website to your existing Business Central (BC) so that
sold-out sizes are greyed out on the site, and every completed purchase creates a
sales order in BC, which lowers the stock on the item.

Because you already use this BC for another website, nothing here touches that
setup — Third Kit gets its own items, its own web customer, and its own app
credentials. Both channels then share the same truthful stock.

**Architecture at a glance**

```
Website (static)  ──GET availability──►  Middleware (Azure Function)  ──►  Business Central
Customer pays on checkout site ──webhook──►  Middleware  ──creates sales order──►  Business Central
```

The website never talks to BC directly (a static site can't keep secrets), and the
website never creates orders — only the checkout provider's webhook can, using a
secret key.

---

## What you need before starting

1. Admin access to your **Business Central online** environment.
2. Access to the **Microsoft Entra admin center** for the same Microsoft 365 tenant
   (or someone who has it — steps 2.1–2.4 need it once).
3. An **Azure subscription** to host the small middleware (a free-tier Function App
   is enough).
4. Your **checkout provider** must be able to send a webhook (an HTTP call) when a
   payment completes. Check their docs/support for "webhooks" or "order
   notifications" — this is the one hard requirement.

---

## Phase 1 — Set up the products in Business Central

Each size is its own item, so stock per size comes straight out of the standard
API with no BC customization.

1.1. In BC, create 12 items (Item Card → New). Suggested numbers:

| Adult | Kids |
|---|---|
| TK-A-XS | TK-K-110 |
| TK-A-S  | TK-K-128 |
| TK-A-M  | TK-K-140 |
| TK-A-L  | TK-K-152 |
| TK-A-XL | TK-K-164 |
| TK-A-XXL| TK-K-176 |

Set Type = Inventory, and your normal posting groups (copy them from an existing
item on the other website if in doubt — or use "Copy Item" on an existing one 12
times and just change the number/description).

1.2. Post the opening stock for each size (e.g. Item Journal or a positive
adjustment), so each item shows the correct **Inventory** quantity.

1.3. Create one customer for this channel, e.g. number `WEB-THIRDKIT`, name
"Third Kit vefverslun", with your normal posting groups. All web orders land on
this customer, which keeps Third Kit orders cleanly separated from the other
website's orders.

1.4. *(Optional but recommended)* Add a dimension value like
`SALESCHANNEL = THIRDKIT` as a default dimension on that customer — then every
Third Kit order is tagged automatically for reporting.

---

## Phase 2 — Give the middleware access to BC

2.1. Go to **entra.microsoft.com** → Applications → App registrations → **New
registration**. Name it e.g. `ThirdKit-BC-Middleware`. No redirect URI needed.

2.2. On the new app: **Certificates & secrets** → New client secret. **Copy the
secret VALUE immediately** (it's only shown once).

2.3. **API permissions** → Add a permission → **Dynamics 365 Business Central** →
**Application permissions** → check `API.ReadWrite.All` → Add. Then click
**Grant admin consent**.

2.4. Note down: **Application (client) ID** and **Directory (tenant) ID** from the
app's Overview page, plus the secret value from 2.2.

2.5. In **Business Central**: search (Alt+Q) for **"Microsoft Entra Applications"**
→ New → paste the Client ID from 2.4, give it a description, set State =
Enabled. Under User Permission Sets, add `D365 SALES DOC, EDIT`, `D365 SALES DOC, POST`
and `D365 BASIC` (or `D365 FULL ACCESS` to start, then tighten later).

---

## Phase 3 — Deploy the middleware (folder `middleware/`)

The `middleware/` folder in this package is a complete Azure Functions app with
two endpoints: `GET /api/availability` and `POST /api/order`.

3.1. In the Azure portal: Create a resource → **Function App**. Runtime: Node.js 20,
plan: Consumption (pay-per-use, effectively free at this volume). Name it e.g.
`thirdkit-func`.

3.2. Deploy the code. Easiest route: install the "Azure Functions" extension in
VS Code, open the `middleware/` folder, and use **Deploy to Function App**.
(Or use `func azure functionapp publish thirdkit-func` with Azure Functions Core
Tools.)

3.3. In the Function App → **Settings → Environment variables**, add:

| Name | Value |
|---|---|
| TENANT_ID | Directory (tenant) ID from 2.4 |
| CLIENT_ID | Application (client) ID from 2.4 |
| CLIENT_SECRET | Secret value from 2.2 |
| BC_ENVIRONMENT | Your BC environment name, usually `Production` |
| BC_COMPANY_ID | Leave empty to auto-pick the first company — set it if your tenant has several companies (the other website's company!) |
| ITEM_MAP | The JSON below |
| DEFAULT_CUSTOMER | `WEB-THIRDKIT` |
| WEBHOOK_SECRET | A long random string you invent — you'll give it to the checkout provider |

ITEM_MAP value (one line):

```json
{"adult":{"XS":"TK-A-XS","S":"TK-A-S","M":"TK-A-M","L":"TK-A-L","XL":"TK-A-XL","XXL":"TK-A-XXL"},"kids":{"110":"TK-K-110","128":"TK-K-128","140":"TK-K-140","152":"TK-K-152","164":"TK-K-164","176":"TK-K-176"}}
```

> **Important (multi-company):** since this BC also serves your other website,
> open BC and check the company name, then set BC_COMPANY_ID explicitly.
> You can find the ID by opening
> `https://api.businesscentral.dynamics.com/v2.0/<TENANT_ID>/Production/api/v2.0/companies`
> in a tool like Postman with the app's token — or just deploy first, and if
> availability returns zeros, the wrong company was picked.

3.4. In the Function App → **API → CORS**: add your website's domain (e.g.
`https://thirdkit.is`) so the browser is allowed to call `/api/availability`.

3.5. Test in a browser:
`https://thirdkit-func.azurewebsites.net/api/availability`
should return your live stock as JSON. If a size shows the wrong number, check
ITEM_MAP and the item's Inventory in BC.

---

## Phase 4 — Connect the website

In `fullordins.html` and `barna.html`, in the CONFIG block at the bottom, set:

```js
const AVAILABILITY_URL = "https://thirdkit-func.azurewebsites.net/api/availability";
```

That's it — on page load the site fetches stock and greys out (strikes through)
any size with 0 on hand. If the middleware is unreachable, the site fails open:
all sizes stay clickable, so a hiccup in Azure never blocks sales.

---

## Phase 5 — Connect the checkout webhook

In your checkout provider's dashboard, configure their "payment completed"
webhook to call:

- URL: `https://thirdkit-func.azurewebsites.net/api/order`
- Header: `x-webhook-secret: <the WEBHOOK_SECRET you invented>`
- Body (JSON):

```json
{ "orderId": "<their order/payment id>", "product": "adult", "size": "M", "quantity": 1 }
```

`product` is `"adult"` or `"kids"` and `size` must match the site's size labels.
Since the site passes `?size=M` on the checkout link, the provider has the size;
how you map their payload to this format depends on the provider — many let you
define a custom payload template. If theirs can't be customized, tell me what
their webhook sends and I'll adapt the middleware to accept their format instead.

The endpoint is idempotent: if the provider retries the same webhook, the order
is only created once (matched on `orderId` → External Document No. in BC).

---

## Phase 6 — Test end to end

1. `GET /api/availability` in a browser → correct numbers per size.
2. Open the product page → sizes with stock 0 in BC are struck through.
3. Send a test webhook (Postman/curl) with the secret header → a new Sales Order
   appears in BC on customer WEB-THIRDKIT with External Document No. = orderId.
4. Send the exact same webhook again → response `already-exists`, no duplicate.
5. Post (ship & invoice) the test order in BC → the item's Inventory drops →
   refresh `/api/availability` → the number went down.
6. Do one real test purchase through the checkout site.

**Note on when stock actually drops:** the *Inventory* field in BC decreases when
the sales order is **posted** (shipped/invoiced), not when it's created. So post
web orders promptly (or set up a batch job / your fulfilment flow to do it), or
sold-out sizes will show later than they should. If you'd rather show
"available = inventory minus open orders", that needs one small custom API page
in BC — say the word and I'll write the AL extension for it.

---

## Quick answers

- **Does this disturb the other website using the same BC?** No. It only reads
  the 12 TK-* items and creates orders on the WEB-THIRDKIT customer. If both
  sites sell the same items, they'd simply share stock — which prevents
  overselling.
- **What if the checkout provider has no webhooks?** Fallback options: a
  Power Automate flow triggered by their order-confirmation email, a daily CSV
  import into BC, or switching provider. Webhooks are strongly preferred.
- **Costs:** the Function App on a consumption plan at this volume is pennies;
  everything else uses licenses you already have.
