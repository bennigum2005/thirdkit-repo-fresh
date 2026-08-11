const { app } = require("@azure/functions");
const crypto = require("crypto");
const { itemMap, createSalesOrder } = require("../bc");

app.http("valitor-callback", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const referenceNumber = request.query.get("ReferenceNumber") || "";
      const signatureResponse = request.query.get("DigitalSignatureResponse") || "";

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

      const m = referenceNumber.match(/^TK-([a-z]+)-([A-Za-z0-9]+)-/);
      const product = m?.[1];
      const size = m?.[2];
      const cfg = itemMap()?.[product];
      const variantCode = cfg?.variants?.[size];
      if (!cfg?.item || !variantCode) {
        context.error(`Callback with unmappable reference: ${referenceNumber}`);
        return { status: 200, body: "OK (unmapped reference logged)" };
      }

      const result = await createSalesOrder(cfg.item, variantCode, 1, referenceNumber);
      context.log(`Valitor payment ${referenceNumber}: BC order ${result.bcOrderNumber} (${result.status})`);
      return { status: 200, body: "OK" };
    } catch (err) {
      context.error(err);
      return { status: 500, body: "Temporary error, please retry" };
    }
  },
});
