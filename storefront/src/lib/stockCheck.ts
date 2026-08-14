// src/lib/stockCheck.ts — server only.
// Stock is checked immediately BEFORE payment, in its own module (course
// ch. 7 & practice step 7): taking money for something you cannot ship costs
// you a refund and a customer. Always queries Magento fresh — no cache.
import "server-only";
import { magentoClient } from "./magentoClient";
import { fetchCart, type CartItem } from "./cart";

export type StockResult =
  | { ok: true }
  | { ok: false; unavailable: Array<{ sku: string; name: string; sizeLabel: string }> };

/**
 * Verifies every cart line's CHILD sku is still in stock. Child stock is read
 * through the parent configurables' variants (children are often not visible
 * individually, so a direct catalogue query would miss them).
 */
export async function checkCartStock(cartId: string): Promise<StockResult> {
  const cart = await fetchCart(cartId);
  if (!cart.items.length) return { ok: true };

  const parentSkus = [
    process.env.MAGENTO_SKU_ADULT ?? "TK01F",
    process.env.MAGENTO_SKU_KIDS ?? "TK02B",
  ];

  type Raw = {
    products: {
      items: Array<{
        variants?: Array<{ product: { sku: string; stock_status: "IN_STOCK" | "OUT_OF_STOCK" } }>;
      }>;
    };
  };
  const data = await magentoClient().request<Raw>(
    /* GraphQL */ `
      query stock($skus: [String!]) {
        products(filter: { sku: { in: $skus } }) {
          items {
            ... on ConfigurableProduct {
              variants { product { sku stock_status } }
            }
          }
        }
      }
    `,
    { skus: parentSkus }
  );

  const inStock = new Map<string, boolean>();
  for (const item of data.products.items) {
    for (const v of item.variants ?? []) {
      inStock.set(v.product.sku, v.product.stock_status === "IN_STOCK");
    }
  }

  const unavailable = cart.items.filter((i: CartItem) => inStock.get(i.sku) === false);
  if (!unavailable.length) return { ok: true };
  return {
    ok: false,
    unavailable: unavailable.map((i) => ({ sku: i.sku, name: i.name, sizeLabel: i.sizeLabel })),
  };
}
