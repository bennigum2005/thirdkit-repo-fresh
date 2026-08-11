const { app } = require("@azure/functions");
const { itemMap, getVariantInventory } = require("../bc");

app.http("availability", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const map = itemMap();
      if (!Object.keys(map).length) {
        return { status: 500, jsonBody: { error: "ITEM_MAP is not configured" } };
      }
      const result = {};
      for (const [product, cfg] of Object.entries(map)) {
        const perVariant = await getVariantInventory(cfg.item);
        result[product] = {};
        for (const [size, variantCode] of Object.entries(cfg.variants || {})) {
          result[product][size] = perVariant[variantCode] ?? 0;
        }
      }
      return { jsonBody: result, headers: { "Cache-Control": "public, max-age=60" } };
    } catch (err) {
      context.error(err);
      return { status: 502, jsonBody: { error: "Could not reach Business Central" } };
    }
  },
});
