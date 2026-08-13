// Product page — a SERVER component (course ch. 3): reads env, calls Magento,
// ships no JS of its own. All interactivity lives in the ProductView island.
import { getProduct, type Product } from "@/lib/products";
import { ProductView } from "@/components/ProductView";
import { Intro } from "@/components/Intro";

export const dynamic = "force-dynamic";

// Design-time fallback so the page renders before the Magento endpoint is
// configured. Every value here is replaced by live Magento data in production.
const FALLBACK: Record<"adult" | "kids", Product> = {
  adult: {
    sku: "TK01F",
    name: "Third Kit",
    price: 9990,
    currency: "ISK",
    variants: ["XS", "S", "M", "L", "XL", "XXL"].map((s) => ({
      sizeLabel: s,
      childSku: `TK01F-${s}`,
      inStock: true,
      price: 9990,
    })),
  },
  kids: {
    sku: "TK02B",
    name: "Third Kit — Barna",
    price: 8990,
    currency: "ISK",
    variants: ["128", "140", "152", "164", "176"].map((s) => ({
      sizeLabel: s,
      childSku: `TK02B-${s}`,
      inStock: true,
      price: 8990,
    })),
  },
};

async function loadProducts() {
  const adultSku = process.env.MAGENTO_SKU_ADULT ?? "TK01F";
  const kidsSku = process.env.MAGENTO_SKU_KIDS ?? "TK02B";
  if (!process.env.MAGENTO_GRAPHQL_ENDPOINT) {
    return { adult: FALLBACK.adult, kids: FALLBACK.kids, live: false };
  }
  try {
    const [adult, kids] = await Promise.all([getProduct(adultSku), getProduct(kidsSku)]);
    return {
      adult: adult ?? FALLBACK.adult,
      kids: kids ?? FALLBACK.kids,
      live: Boolean(adult && kids),
    };
  } catch {
    // Circuit breaker open or Magento down — degrade instead of hanging (ch. 8)
    return { adult: FALLBACK.adult, kids: FALLBACK.kids, live: false };
  }
}

export default async function Home() {
  const { adult, kids, live } = await loadProducts();

  return (
    <section className="flex-1 flex items-center justify-center px-[6vw] pt-24 pb-14">
      <ProductView adult={adult} kids={kids} live={live} />
      <Intro />
    </section>
  );
}
