let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedCompanyId = null;
const cachedIds = {};

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

function envBase() {
  const tenant = process.env.TENANT_ID;
  const env = process.env.BC_ENVIRONMENT || "Production";
  return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}`;
}

async function rawFetch(url, options = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`BC ${options.method || "GET"} ${url} failed: ${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function bcFetch(path, options = {}) {
  return rawFetch(`${envBase()}/api/v2.0${path}`, options);
}

async function odataFetch(serviceAndQuery) {
  const company = encodeURIComponent(process.env.BC_COMPANY_NAME || "");
  return rawFetch(`${envBase()}/ODataV4/Company('${company}')/${serviceAndQuery}`);
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

async function getItemAndVariantId(itemNumber, variantCode) {
  const cached = cachedIds[itemNumber];
  if (cached?.variants?.[variantCode]) {
    return { itemId: cached.id, variantId: cached.variants[variantCode] };
  }
  const companyId = await getCompanyId();
  const items = await bcFetch(
    `/companies(${companyId})/items?$filter=number eq '${itemNumber.replace(/'/g, "''")}'&$select=id,number`
  );
  const item = items.value?.[0];
  if (!item) throw new Error(`Item ${itemNumber} not found in BC`);
  const variants = await bcFetch(`/companies(${companyId})/items(${item.id})/itemVariants?$select=id,code`);
  const map = {};
  for (const v of variants.value || []) map[v.code] = v.id;
  cachedIds[itemNumber] = { id: item.id, variants: map };
  const variantId = map[variantCode];
  if (!variantId) throw new Error(`Variant '${variantCode}' not found on item ${itemNumber}`);
  return { itemId: item.id, variantId };
}

async function getVariantInventory(itemNumber) {
  const service = process.env.BC_LEDGER_SERVICE || "SiteItemLedger";
  const filter = encodeURIComponent(`Item_No eq '${itemNumber.replace(/'/g, "''")}'`);
  const data = await odataFetch(`${service}?$filter=${filter}&$select=Item_No,Variant_Code,Quantity`);
  const perVariant = {};
  for (const row of data.value || []) {
    const code = row.Variant_Code || "";
    perVariant[code] = (perVariant[code] || 0) + Number(row.Quantity || 0);
  }
  return perVariant;
}

async function createSalesOrder(itemNumber, variantCode, quantity, externalDocNumber) {
  const companyId = await getCompanyId();
  const existing = await bcFetch(
    `/companies(${companyId})/salesOrders?$filter=externalDocumentNumber eq '${externalDocNumber.replace(/'/g, "''")}'&$select=id,number`
  );
  if (existing.value?.length) {
    return { status: "already-exists", bcOrderNumber: existing.value[0].number };
  }
  const { variantId } = await getItemAndVariantId(itemNumber, variantCode);
  const order = await bcFetch(`/companies(${companyId})/salesOrders`, {
    method: "POST",
    body: JSON.stringify({
      customerNumber: process.env.DEFAULT_CUSTOMER,
      externalDocumentNumber: externalDocNumber,
    }),
  });
  await bcFetch(`/companies(${companyId})/salesOrders(${order.id})/salesOrderLines`, {
    method: "POST",
    body: JSON.stringify({
      lineType: "Item",
      lineObjectNumber: itemNumber,
      itemVariantId: variantId,
      quantity: quantity,
    }),
  });
  return { status: "created", bcOrderNumber: order.number };
}

module.exports = { bcFetch, odataFetch, getCompanyId, itemMap, getVariantInventory, createSalesOrder };
