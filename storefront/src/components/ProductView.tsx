"use client";
// The interactive island (course ch. 3): category + size pills, qty, add to cart.
// It is shipped to the browser, so it is never trusted with money — prices
// shown here are display only; the charge is computed server-side from the
// Magento cart.
import { useState } from "react";
import type { Product } from "@/lib/products";

type Props = { adult: Product; kids: Product; live: boolean };
type Cat = "adult" | "kids";

const kr = (n: number) => n.toLocaleString("is-IS").replace(/,/g, ".") + " kr.";

// The mystery box product shot — same image for both versions (public/box.png).
// No frame, no crop: the photo's own dark backdrop fades out at the edges so
// it merges seamlessly with the page background — the box floats on the page.
function Jersey({ cat }: { cat: Cat }) {
  void cat;
  const mask = "radial-gradient(ellipse 72% 72% at center, black 58%, transparent 98%)";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/box.png"
      alt="Third Kit Mystery Box"
      className="w-[clamp(230px,68vw,340px)] md:w-[clamp(340px,56vh,700px)] h-auto"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}

export function ProductView({ adult, kids, live }: Props) {
  const [cat, setCat] = useState<Cat>("adult");
  const [childSku, setChildSku] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const product = cat === "adult" ? adult : kids;
  const selected = product.variants.find((v) => v.childSku === childSku) ?? null;

  async function addToCart() {
    if (!selected) {
      setError("Vinsamlegast veldu stærð fyrst.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: selected.childSku, qty }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAdded(true);
      window.dispatchEvent(new Event("tk-cart-changed"));
      setTimeout(() => setAdded(false), 3000);
    } catch {
      setError("Ekki tókst að bæta í körfu — reyndu aftur.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-6 md:gap-16 xl:gap-24 items-center w-full max-w-[1020px] xl:max-w-[1500px]">
      <div
        className="relative flex items-center justify-center rounded-lg border p-4 md:p-10 xl:p-14 overflow-hidden"
        style={{
          background: "linear-gradient(180deg, var(--black-3), var(--black-2))",
          borderColor: "rgba(212,175,55,.22)",
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: "linear-gradient(90deg, transparent, var(--gold), transparent)" }} />
        <Jersey cat={cat} />
      </div>

      <div className="text-center md:text-left">
        <h1 className="uppercase font-extrabold tracking-[0.08em] text-3xl md:text-4xl xl:text-5xl">Third Kit</h1>
        <div className="font-extrabold text-2xl md:text-3xl xl:text-4xl mt-2" style={{ color: "var(--gold-bright)" }}>
          {kr(selected?.price ?? product.price)}
        </div>

        <div className="mt-5 mb-2.5 text-[0.72rem] xl:text-[0.88rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
          Veldu útgáfu
        </div>
        <div className="flex flex-wrap gap-3 justify-center md:justify-start">
          {(["adult", "kids"] as Cat[]).map((c) => (
            <button key={c} className={`pill ${cat === c ? "selected" : ""}`}
              onClick={() => { setCat(c); setChildSku(null); setError(null); }}>
              {c === "adult" ? "Fullorðins" : "Barna"}
            </button>
          ))}
        </div>

        <div className="mt-5 mb-2.5 text-[0.72rem] xl:text-[0.88rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
          Veldu stærð
        </div>
        <div className="flex flex-wrap gap-3 justify-center md:justify-start">
          {product.variants.map((v) => (
            <button key={v.childSku} className={`pill ${childSku === v.childSku ? "selected" : ""}`}
              disabled={!v.inStock} title={v.inStock ? undefined : "Uppselt"}
              onClick={() => { setChildSku(v.childSku); setError(null); }}>
              {v.sizeLabel}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-3.5 text-[0.8rem] tracking-[0.06em]" style={{ color: "var(--gold-bright)" }}>{error}</p>
        )}
        {!live && (
          <p className="mt-3.5 text-[0.7rem] tracking-[0.06em]" style={{ color: "var(--muted)" }}>
            Sýnigögn — Magento-tenging ekki virk enn.
          </p>
        )}

        <div className="mt-5 mb-2.5 text-[0.72rem] xl:text-[0.88rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
          Magn
        </div>
        <div className="flex items-center gap-4 justify-center md:justify-start">
          <button
            className="w-11 h-11 xl:w-14 xl:h-14 rounded-xl text-lg xl:text-2xl cursor-pointer disabled:opacity-40"
            style={{ border: "1px solid var(--gold-dim)", color: "var(--gold-bright)", background: "transparent" }}
            onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
          <span className="min-w-6 text-center font-extrabold text-lg xl:text-2xl">{qty}</span>
          <button
            className="w-11 h-11 xl:w-14 xl:h-14 rounded-xl text-lg xl:text-2xl cursor-pointer disabled:opacity-40"
            style={{ border: "1px solid var(--gold-dim)", color: "var(--gold-bright)", background: "transparent" }}
            onClick={() => setQty((q) => Math.min(10, q + 1))} disabled={qty >= 10}>+</button>
        </div>

        <button className="btn-gold w-full mt-5" onClick={addToCart} disabled={busy}>
          {busy ? "Augnablik…" : added ? "Komið í körfuna ✓" : "Setja í körfu"}
        </button>
        <p className="mt-3 text-[0.7rem] tracking-[0.08em]" style={{ color: "var(--muted)" }}>
          Þú verður send/ur áfram á örugga greiðslusíðu
        </p>
      </div>
    </div>
  );
}
