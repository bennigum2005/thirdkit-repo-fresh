// src/lib/cart.ts — server only.
// The cart is a record in Magento (course ch. 5). The browser holds only an id
// in an httpOnly cookie; this module is the only thing connecting the two.
import "server-only";
import { cookies } from "next/headers";
import { magentoClient } from "./magentoClient";
import { cacheKey, cacheGet, cacheSet, cacheDel } from "./cache";

const CART_COOKIE = "magento_cart_id";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type CartItem = {
  uid: string;
  sku: string;
  name: string;
  sizeLabel: string;
  quantity: number;
  rowTotal: number;
};

export type Cart = {
  id: string;
  items: CartItem[];
  grandTotal: number;
  currency: string;
};

const CART_QUERY = /* GraphQL */ `
  query cart($cartId: String!) {
    cart(cart_id: $cartId) {
      id
      items {
        uid
        quantity
        product { sku name }
        ... on ConfigurableCartItem {
          configurable_options { option_label value_label }
          configured_variant { sku }
        }
        prices { row_total_including_tax { value } }
      }
      prices { grand_total { value currency } }
    }
  }
`;

/** Read the cart id from the cookie; create a guest cart first if there is none. */
export async function ensureCartId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return existing;

  const data = await magentoClient().request<{ createEmptyCart: string }>(
    /* GraphQL */ `mutation { createEmptyCart }`
  );
  const cartId = data.createEmptyCart;
  jar.set(CART_COOKIE, cartId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return cartId;
}

/** Drop the cookie so the next touch creates a fresh cart (used after an order). */
export async function resetCart(): Promise<void> {
  const jar = await cookies();
  jar.delete(CART_COOKIE);
}

/** Detect Magento's "cart is no longer active" error (after placeOrder). */
export function isInactiveCartError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /active|not.*found|could not find a cart/i.test(msg);
}

/** Read one cart from Magento, through the cache. */
export async function fetchCart(cartId: string): Promise<Cart> {
  const key = cacheKey("cart", { cartId });
  const cached = cacheGet<Cart>(key);
  if (cached) return cached;

  type Raw = {
    cart: {
      id: string;
      items: Array<{
        uid: string;
        quantity: number;
        product: { sku: string; name: string };
        configurable_options?: Array<{ option_label: string; value_label: string }>;
        configured_variant?: { sku: string };
        prices: { row_total_including_tax: { value: number } };
      }>;
      prices: { grand_total: { value: number; currency: string } };
    };
  };

  const data = await magentoClient().request<Raw>(CART_QUERY, { cartId });
  const cart: Cart = {
    id: data.cart.id,
    items: data.cart.items.map((i) => ({
      uid: i.uid,
      sku: i.configured_variant?.sku ?? i.product.sku,
      name: i.product.name,
      sizeLabel:
        i.configurable_options?.find((o) => o.option_label.toLowerCase().includes("size"))
          ?.value_label ?? i.configurable_options?.[0]?.value_label ?? "",
      quantity: i.quantity,
      rowTotal: i.prices.row_total_including_tax.value,
    })),
    grandTotal: data.cart.prices.grand_total.value,
    currency: data.cart.prices.grand_total.currency,
  };

  cacheSet(key, cart, 30); // short TTL; every write below invalidates anyway
  return cart;
}

/** Add an item — note: the CHILD sku (course ch. 5). */
export async function addToCart(cartId: string, childSku: string, qty: number): Promise<void> {
  await magentoClient().request(
    /* GraphQL */ `
      mutation add($cartId: String!, $sku: String!, $qty: Float!) {
        addProductsToCart(cartId: $cartId, cartItems: [{ sku: $sku, quantity: $qty }]) {
          cart { id }
          user_errors { code message }
        }
      }
    `,
    { cartId, sku: childSku, qty }
  );
  cacheDel(cacheKey("cart", { cartId }));
}

export async function updateItemQty(cartId: string, itemUid: string, qty: number): Promise<void> {
  await magentoClient().request(
    /* GraphQL */ `
      mutation upd($cartId: String!, $uid: ID!, $qty: Float!) {
        updateCartItems(input: { cart_id: $cartId, cart_items: [{ cart_item_uid: $uid, quantity: $qty }] }) {
          cart { id }
        }
      }
    `,
    { cartId, uid: itemUid, qty }
  );
  cacheDel(cacheKey("cart", { cartId }));
}

export async function removeItem(cartId: string, itemUid: string): Promise<void> {
  await magentoClient().request(
    /* GraphQL */ `
      mutation rm($cartId: String!, $uid: ID!) {
        removeItemFromCart(input: { cart_id: $cartId, cart_item_uid: $uid }) {
          cart { id }
        }
      }
    `,
    { cartId, uid: itemUid }
  );
  cacheDel(cacheKey("cart", { cartId }));
}
