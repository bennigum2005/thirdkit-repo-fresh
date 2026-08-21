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

// Product gallery — all shots share the site's black/gold backdrop.
// scale crops into images that carry their own dark padding.
const GALLERY = [
  { src: "/box.png", scale: 1.32 },
  { src: "/gallery/lokad.png?v=2", scale: 1.0 },
  { src: "/gallery/opid.png?v=2", scale: 1.0 },
  { src: "/gallery/hopur.png?v=2", scale: 1.0 },
];

export function ProductView({ adult, kids, live }: Props) {
  const [cat, setCat] = useState<Cat>("adult");
  const [childSku, setChildSku] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);

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
      setQty(1); // fresh start for the next line — magnið byrjar alltaf á 1
      window.dispatchEvent(new Event("tk-cart-changed"));
      setTimeout(() => setAdded(false), 3000);
    } catch {
      setError("Ekki tókst að bæta í körfu — reyndu aftur.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-6 md:gap-14 xl:gap-20 items-center w-full max-w-[1100px] xl:max-w-[1560px]">
      <div>
        <div
          className="relative rounded-lg border overflow-hidden aspect-square w-full max-h-[400px] md:max-h-none"
          style={{
            background: "linear-gradient(180deg, var(--black-3), var(--black-2))",
            borderColor: "rgba(212,175,55,.22)",
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-[3px] z-10"
            style={{ background: "linear-gradient(90deg, transparent, var(--gold), transparent)" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={GALLERY[imgIdx].src}
            alt="Third Kit Mystery Box"
            className="w-full h-full object-cover"
            style={{ transform: `scale(${GALLERY[imgIdx].scale})`, transformOrigin: "center 47%" }}
          />
        </div>
        <div className="flex gap-2.5 mt-3 justify-center">
          {GALLERY.map((g, i) => (
            <button key={g.src}
              onClick={() => setImgIdx(i)}
              className="w-16 h-16 md:w-20 md:h-20 rounded-lg overflow-hidden cursor-pointer flex-shrink-0"
              style={{
                border: i === imgIdx ? "2px solid var(--gold)" : "2px solid rgba(255,255,255,.14)",
                opacity: i === imgIdx ? 1 : 0.7,
                background: "var(--black-2)",
                padding: 0,
              }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.src} alt="" className="w-full h-full object-cover"
                style={{ transform: `scale(${g.scale})` }} />
            </button>
          ))}
        </div>
      </div>

      <div className="text-center md:text-left">
        <h1 className="uppercase font-extrabold tracking-[0.04em] leading-[1.05] text-4xl md:text-5xl xl:text-6xl">
          Third Kit<span className="block text-[0.55em]" style={{ color: "var(--muted)" }}>Mystery Box</span>
        </h1>
        <div className="font-bold text-xl md:text-2xl xl:text-3xl mt-3" style={{ color: "var(--gold-bright)" }}>
          {kr(selected?.price ?? product.price)}
        </div>

        <div className="mt-5 mb-2.5 text-[0.72rem] xl:text-[0.88rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
          Veldu útgáfu
        </div>
        <div className="flex flex-wrap gap-3 justify-center md:justify-start">
          {(["adult", "kids"] as Cat[]).map((c) => (
            <button key={c} className={`pill ${cat === c ? "selected" : ""}`}
              onClick={() => { setCat(c); setChildSku(null); setQty(1); setError(null); }}>
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
              onClick={() => { setChildSku(v.childSku); setQty(1); setError(null); }}>
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
          {busy
            ? "Augnablik…"
            : added
              ? "Komið í körfuna ✓"
              : `Setja í körfu • ${kr((selected?.price ?? product.price) * qty)}`}
        </button>
        <p className="mt-3 text-[0.7rem] tracking-[0.08em]" style={{ color: "var(--muted)" }}>
          Þú verður send/ur áfram á örugga greiðslusíðu
        </p>
      </div>
    </div>
  );
}
