const { app } = require("@azure/functions");
const { bcFetch, getCompanyId, itemMap } = require("../bc");

/**
 * POST /api/order
 *
 * Called by the CHECKOUT PROVIDER's webhook after a successful payment —
 * never directly from the website (the browser must not be able to create orders).
 *
 * Headers:  x-webhook-secret: <WEBHOOK_SECRET>
 * Body:     { "orderId": "CHK-1001", "product": "adult", "size": "M", "quantity": 1 }
 *
 * Creates a sales order in Business Central for the mapped item.
 * Idempotent: if an order with the same orderId (externalDocumentNumber)
 * already exists, it is not created again.
 */
app.http("order", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      // 1. Authenticate the webhook
      const secret = request.headers.get("x-webhook-secret");
      if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
        return { status: 401, jsonBody: { error: "Invalid webhook secret" } };
      }

      // 2. Validate payload
      const body = await request.json();
      const { orderId, product, size, quantity } = body || {};
      const qty = Number(quantity) || 1;
      const map = itemMap();
      const itemNumber = map?.[product]?.[String(size)];
      if (!orderId || !itemNumber) {
        return { status: 400, jsonBody: { error: "Missing/unknown orderId, product or size", body } };
      }

      const companyId = await getCompanyId();

      // 3. Idempotency: skip if this checkout order was already imported
      const existing = await bcFetch(
        `/companies(${companyId})/salesOrders?$filter=externalDocumentNumber eq '${orderId.replace(/'/g, "''")}'&$select=id,number`
      );
      if (existing.value?.length) {
        return { jsonBody: { status: "already-exists", bcOrderNumber: existing.value[0].number } };
      }

      // 4. Create the sales order
      const order = await bcFetch(`/companies(${companyId})/salesOrders`, {
        method: "POST",
        body: JSON.stringify({
          customerNumber: process.env.DEFAULT_CUSTOMER,
          externalDocumentNumber: orderId,
        }),
      });

      // 5. Add the order line (the item's variant-per-size is its own item number)
      await bcFetch(`/companies(${companyId})/salesOrders(${order.id})/salesOrderLines`, {
        method: "POST",
        body: JSON.stringify({
          lineType: "Item",
          lineObjectNumber: itemNumber,
          quantity: qty,
        }),
      });

      context.log(`Created BC sales order ${order.number} for checkout order ${orderId}`);
      return { jsonBody: { status: "created", bcOrderNumber: order.number } };
    } catch (err) {
      context.error(err);
      return { status: 502, jsonBody: { error: "Could not create order in Business Central" } };
    }
  },
});
