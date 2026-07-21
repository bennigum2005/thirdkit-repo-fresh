/**
 * Shared helpers for talking to Business Central.
 *
 * Required environment variables (set these in the Function App > Configuration):
 *
 *   TENANT_ID        - Microsoft Entra tenant ID (GUID or yourdomain.onmicrosoft.com)
 *   CLIENT_ID        - App registration (client) ID
 *   CLIENT_SECRET    - App registration client secret VALUE
 *   BC_ENVIRONMENT   - Business Central environment name, usually "Production"
 *   BC_COMPANY_ID    - Company ID (GUID). Leave empty to auto-pick the first company.
 *   ITEM_MAP         - JSON mapping of product/size -> BC item number, e.g.
 *                      {"adult":{"XS":"TK-A-XS","S":"TK-A-S","M":"TK-A-M","L":"TK-A-L","XL":"TK-A-XL","XXL":"TK-A-XXL"},
 *                       "kids":{"110":"TK-K-110","128":"TK-K-128","140":"TK-K-140","152":"TK-K-152","164":"TK-K-164","176":"TK-K-176"}}
 *   DEFAULT_CUSTOMER - BC customer number used for web orders, e.g. "WEB-THIRDKIT"
 *   WEBHOOK_SECRET   - Shared secret the checkout provider must send in the
 *                      "x-webhook-secret" header when posting orders
 */

let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedCompanyId = null;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - 60_000) return cachedToken;

  const tenant = process.env.TENANT_ID;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      scope: "https://api.businesscentral.dynamics.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = now + data.expires_in * 1000;
  return cachedToken;
}

function apiBase() {
  const tenant = process.env.TENANT_ID;
  const env = process.env.BC_ENVIRONMENT || "Production";
  return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0`;
}

async function bcFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`BC ${options.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function getCompanyId() {
  if (process.env.BC_COMPANY_ID) return process.env.BC_COMPANY_ID;
  if (cachedCompanyId) return cachedCompanyId;
  const data = await bcFetch(`/companies`);
  if (!data.value?.length) throw new Error("No companies found in Business Central");
  cachedCompanyId = data.value[0].id;
  return cachedCompanyId;
}

function itemMap() {
  return JSON.parse(process.env.ITEM_MAP || "{}");
}

module.exports = { bcFetch, getCompanyId, itemMap };
