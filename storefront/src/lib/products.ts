// src/lib/products.ts — server only.
// Product catalogue reads (course ch. 4). The customer sees the configurable
// product; the cart receives the CHILD sku. Stock belongs to the child.
import "server-only";
import { magentoClient } from "./magentoClient";
import { cacheKey, cacheGet, cacheSet } from "./cache";

export type Variant = {
  sizeLabel: string;
  childSku: string;
  inStock: boolean;
  price: number;
};

export type Product = {
  sku: string;
  name: string;
  price: number;
  currency: string;
  variants: Variant[];
};

const PRODUCT_QUERY = /* GraphQL */ `
  query product($sku: String!) {
    products(filter: { sku: { eq: $sku } }) {
      items {
        sku
        name
        price_range { minimum_price { final_price { value currency } } }
        ... on ConfigurableProduct {
          variants {
            attributes { code label value_index }
            product {
              sku
              stock_status
              price_range { minimum_price { final_price { value } } }
            }
          }
        }
      }
    }
  }
`;

type Raw = {
  products: {
    items: Array<{
      sku: string;
      name: string;
      price_range: { minimum_price: { final_price: { value: number; currency: string } } };
      variants?: Array<{
        attributes: Array<{ code: string; label: string; value_index: number }>;
        product: {
          sku: string;
          stock_status: "IN_STOCK" | "OUT_OF_STOCK";
          price_range: { minimum_price: { final_price: { value: number } } };
        };
      }>;
    }>;
  };
};

/** Fetch one configurable product with its size variants. Cached 60s (public data). */
export async function getProduct(sku: string): Promise<Product | null> {
  const key = cacheKey("product", { sku });
  const cached = cacheGet<Product>(key);
  if (cached) return cached;

  const data = await magentoClient().request<Raw>(PRODUCT_QUERY, { sku });
  const item = data.products.items[0];
  if (!item) return null;

  const product: Product = {
    sku: item.sku,
    name: item.name,
    price: item.price_range.minimum_price.final_price.value,
    currency: item.price_range.minimum_price.final_price.currency,
    variants: (item.variants ?? []).map((v) => ({
      sizeLabel:
        v.attributes.find((a) => a.code.toLowerCase().includes("size"))?.label ??
        v.attributes[0]?.label ?? v.product.sku,
      childSku: v.product.sku,
      inStock: v.product.stock_status === "IN_STOCK",
      price: v.product.price_range.minimum_price.final_price.value,
    })),
  };

  cacheSet(key, product, 60);
  return product;
}
