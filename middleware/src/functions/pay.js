const { app } = require("@azure/functions");
const crypto = require("crypto");
const { itemMap, getVariantInventory } = require("../bc");

app.http("pay", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const product = (request.query.get("product") || "").toLowerCase();
      const size = request.query.get("size") || "";
      const map = itemMap();
      const prices = JSON.parse(process.env.PRICES || "{}");
      const cfg = map?.[product];
      const variantCode = cfg?.variants?.[size];
      const price = prices?.[product];
      const productPage = product === "kids" ? "barna.html" : "fullordins.html";

      if (!cfg?.item || !variantCode || !price) {
        return { status: 400, body: "Othekkt vara eda staerd." };
      }

      try {
        const perVariant = await getVariantInventory(cfg.item);
        if ((perVariant[variantCode] ?? 0) <= 0) {
          return { status: 302, headers: { Location: `${process.env.SITE_BASE_URL}/${productPage}?soldout=1` } };
        }
      } catch (e) {
        context.warn("Stock pre-check failed, allowing purchase: " + e.message);
      }

      const unique = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
      const referenceNumber = `TK-${product}-${size}-${unique}`;

      const merchantId = process.env.VALITOR_MERCHANT_ID;
      const verificationCode = process.env.VALITOR_VERIFICATION_CODE;
      const currency = "ISK";
      const quantity = "1";
      const discount = "0";
      const priceStr = String(price);
      const successUrl = `${process.env.SITE_BASE_URL}/takk.html`;
      const serverSideUrl = `${process.env.MIDDLEWARE_BASE_URL}/api/valitor-callback`;
      const cancelUrl = `${process.env.SITE_BASE_URL}/${productPage}`;

      const description =
        product === "kids"
          ? `Third Kit - Barna, staerd ${size}`
          : `Third Kit - Fullordins, staerd ${size}`;

      const signatureSeed =
        verificationCode + "0" + quantity + priceStr + discount +
        merchantId + referenceNumber + successUrl + serverSideUrl + currency;
      const digitalSignature = crypto.createHash("sha256").update(signatureSeed, "utf8").digest("hex");

      const params = new URLSearchParams({
        MerchantID: merchantId,
        AuthorizationOnly: "0",
        ReferenceNumber: referenceNumber,
        Currency: currency,
        Product_1_Description: description,
        Product_1_Quantity: quantity,
        Product_1_Price: priceStr,
        Product_1_Discount: discount,
        PaymentSuccessfulURL: successUrl,
        PaymentSuccessfulServerSideURL: serverSideUrl,
        PaymentCancelledURL: cancelUrl,
        DigitalSignature: digitalSignature,
      });

      const url = `${process.env.VALITOR_PAGE_URL}?${params.toString()}`;
      context.log(`Redirecting to Valitor: ${referenceNumber}`);
      return { status: 302, headers: { Location: url } };
    } catch (err) {
      context.error(err);
      return { status: 500, body: "Villa kom upp vid ad stofna greidslu." };
    }
  },
});
