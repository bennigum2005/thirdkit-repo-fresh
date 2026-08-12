const { app } = require("@azure/functions");
const crypto = require("crypto");
const { itemMap, createSalesOrder } = require("../bc");

/**
 * GET /api/valitor-callback
 *
 * PaymentSuccessfulServerSideURL — Valitor (Rapyd) calls this server-to-server
 * when a payment succeeds, with querystring parameters including
 * ReferenceNumber and DigitalSignatureResponse.
 *
 * We validate the signature (SHA256 of VerificationCode + ReferenceNumber),
 * parse product/size out of the ReferenceNumber, and create the sales order
 * in Business Central. Idempotent on ReferenceNumber.
 */
app.http("valitor-callback", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const referenceNumber = request.query.get("ReferenceNumber") || "";
      const signatureResponse = request.query.get("DigitalSignatureResponse") || "";

      // 1. Validate the signature so only Valitor can trigger orders
      const expected = crypto
        .createHash("sha256")
        .update(process.env.VALITOR_VERIFICATION_CODE + referenceNumber, "utf8")
        .digest("hex");
      const expectedMd5 = crypto
        .createHash("md5")
        .update(process.env.VALITOR_VERIFICATION_CODE + referenceNumber, "utf8")
        .digest("hex");
      const sig = signatureResponse.toLowerCase();
      if (!referenceNumber || (sig !== expected && sig !== expectedMd5)) {
        context.warn(`Invalid callback signature for ref '${referenceNumber}'`);
        return { status: 401, body: "Invalid signature" };
      }

      // 2. Parse ReferenceNumber: TK-<product>-<size>-<unique>
      const m = referenceNumber.match(/^TK-([a-z]+)-([A-Za-z0-9]+)-q(\d+)-/);
      const product = m?.[1];
      const size = m?.[2];
      const qty = Math.min(10, Math.max(1, parseInt(m?.[3] || "1", 10) || 1));
      const cfg = itemMap()?.[product];
      const variantCode = cfg?.variants?.[size];
      if (!cfg?.item || !variantCode) {
        context.error(`Callback with unmappable reference: ${referenceNumber}`);
        // Return 200 so Valitor doesn't retry forever; log loudly instead.
        return { status: 200, body: "OK (unmapped reference logged)" };
      }

      // 3. Create the sales order in Business Central
      const result = await createSalesOrder(cfg.item, variantCode, qty, referenceNumber);
      context.log(`Valitor payment ${referenceNumber}: BC order ${result.bcOrderNumber} (${result.status})`);

      return { status: 200, body: "OK" };
    } catch (err) {
      context.error(err);
      // Non-200 so Valitor retries — the payment DID succeed, we must not lose the order.
      return { status: 500, body: "Temporary error, please retry" };
    }
  },
});
