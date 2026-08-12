const { app } = require("@azure/functions");
const { itemMap, createSalesOrder } = require("../bc");
const { getCheckout } = require("../verifone");

/**
 * GET /api/confirm?ref=TK-...&cid=<checkoutId>
 *
 * Verifone's return_url. The customer lands here after paying (or cancelling).
 * We verify the result SERVER-SIDE by fetching the checkout from Verifone's
 * API with our credentials — the browser can't forge that — and only then
 * create the sales order in Business Central. Finally the customer is sent
 * to takk.html (success) or back to the product page (not completed).
 *
 * Idempotent on ref (External Document No. in BC).
 */
app.http("confirm", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const site = process.env.SITE_BASE_URL;
    try {
      const ref = request.query.get("ref") || "";
      // Verifone may also append its own id parameter — accept several names.
      const cid = request.query.get("cid")
        || request.query.get("checkout_id")
        || request.query.get("checkoutId")
        || request.query.get("id") || "";

      const m = ref.match(/^TK-([a-z]+)-([A-Za-z0-9]+)-q(\d+)-/);
      const product = m?.[1];
      const size = m?.[2];
      const qty = Math.min(10, Math.max(1, parseInt(m?.[3] || "1", 10) || 1));
      const cfg = itemMap()?.[product];
      const variantCode = cfg?.variants?.[size];
      const productPage = product === "kids" ? "barna.html" : "fullordins.html";

      if (!cfg?.item || !variantCode || !cid) {
        context.warn(`Confirm with missing data: ref='${ref}' cid='${cid}'`);
        return { status: 302, headers: { Location: `${site}/index.html` } };
      }

      // Server-side verification against Verifone
      const checkout = await getCheckout(cid);
      const status = (checkout.status || checkout.state || "").toUpperCase();
      const refMatches = !checkout.merchant_reference || checkout.merchant_reference === ref;

      if (status === "COMPLETED" && refMatches) {
        const result = await createSalesOrder(cfg.item, variantCode, qty, ref);
        context.log(`Verifone ${cid} completed: BC order ${result.bcOrderNumber} (${result.status})`);
        return { status: 302, headers: { Location: `${site}/takk.html?ReferenceNumber=${encodeURIComponent(ref)}` } };
      }

      context.warn(`Verifone ${cid} not completed (status=${status}, refMatch=${refMatches})`);
      return { status: 302, headers: { Location: `${site}/${productPage}` } };
    } catch (err) {
      context.error(err);
      return { status: 302, headers: { Location: `${site}/index.html` } };
    }
  },
});
