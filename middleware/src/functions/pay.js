const { app } = require("@azure/functions");
const crypto = require("crypto");
const { itemMap, getVariantInventory } = require("../bc");
const { createCheckout, updateCheckout } = require("../verifone");

/**
 * GET /api/pay?product=adult&size=M&qty=1
 *
 * Called by the basket page. Creates a Verifone hosted checkout (price decided
 * server-side from PRICES) and redirects the customer to Verifone's payment page.
 */
app.http("pay", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const product = (request.query.get("product") || "").toLowerCase();
      const size = request.query.get("size") || "";
      const qty = Math.min(10, Math.max(1, parseInt(request.query.get("qty") || "1", 10) || 1));
      const map = itemMap();
      const prices = JSON.parse(process.env.PRICES || "{}");
      const cfg = map?.[product];
      const variantCode = cfg?.variants?.[size];
      const price = prices?.[product];
      const productPage = product === "kids" ? "barna.html" : "fullordins.html";

      if (!cfg?.item || !variantCode || !price) {
        return { status: 400, body: "Óþekkt vara eða stærð." };
      }

      // Check stock (per variant) before sending the customer to pay
      try {
        const perVariant = await getVariantInventory(cfg.item);
        if ((perVariant[variantCode] ?? 0) < qty) {
          return { status: 302, headers: { Location: `${process.env.SITE_BASE_URL}/${productPage}?soldout=1` } };
        }
      } catch (e) {
        context.warn("Stock pre-check failed, allowing purchase: " + e.message);
      }

      // Reference encodes product+size+qty so confirmation can map it back.
      const unique = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
      const referenceNumber = `TK-${product}-${size}-q${qty}-${unique}`;

      const description =
        product === "kids"
          ? `Third Kit - Barna, staerd ${size}`
          : `Third Kit - Fullordins, staerd ${size}`;

      const baseReturn = `${process.env.MIDDLEWARE_BASE_URL}/api/confirm?ref=${encodeURIComponent(referenceNumber)}`;
      const checkout = await createCheckout({
        amount: price * qty,
        currency: "ISK",
        reference: referenceNumber,
        returnUrl: baseReturn,
        description,
      });

      // Bake the checkout id into the return URL so /api/confirm can verify
      // the payment against Verifone's API when the customer comes back.
      try {
        await updateCheckout(checkout.id, { return_url: `${baseReturn}&cid=${encodeURIComponent(checkout.id)}` });
      } catch (e) {
        context.warn("Could not update return_url with checkout id: " + e.message);
      }

      context.log(`Created Verifone checkout ${checkout.id} for ${referenceNumber}`);
      return { status: 302, headers: { Location: checkout.url } };
    } catch (err) {
      context.error(err);
      return { status: 500, body: "Villa kom upp við að stofna greiðslu." };
    }
  },
});
