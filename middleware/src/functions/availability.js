const { app } = require("@azure/functions");
const { bcFetch, getCompanyId, itemMap } = require("../bc");

/**
 * GET /api/availability
 *
 * Returns stock per product/size, e.g.:
 *   { "adult": { "XS": 3, "S": 0, ... }, "kids": { "110": 5, ... } }
 *
 * The website fetches this on page load and disables sold-out sizes.
 * Numbers come straight from the "inventory" field on each BC item.
 */
app.http("availability", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const map = itemMap();
      const companyId = await getCompanyId();

      // Collect every BC item number referenced in ITEM_MAP
      const numbers = Object.values(map).flatMap((sizes) => Object.values(sizes));
      if (!numbers.length) return { status: 500, jsonBody: { error: "ITEM_MAP is not configured" } };

      // One filtered query for all items
      const filter = numbers.map((n) => `number eq '${n.replace(/'/g, "''")}'`).join(" or ");
      const data = await bcFetch(
        `/companies(${companyId})/items?$filter=${encodeURIComponent(filter)}&$select=number,inventory`
      );

      const inventoryByNumber = {};
      for (const item of data.value || []) inventoryByNumber[item.number] = item.inventory;

      const result = {};
      for (const [product, sizes] of Object.entries(map)) {
        result[product] = {};
        for (const [size, number] of Object.entries(sizes)) {
          result[product][size] = inventoryByNumber[number] ?? 0;
        }
      }

      return {
        jsonBody: result,
        headers: { "Cache-Control": "public, max-age=60" },
      };
    } catch (err) {
      context.error(err);
      return { status: 502, jsonBody: { error: "Could not reach Business Central" } };
    }
  },
});
