"use client";
// Cart page — reached ONLY via the cart icon. Reads the real Magento cart
// through /api/cart. Totals shown are display only; the amount charged is
// computed server-side (course ch. 7).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type CartItem = {
  uid: string;
  sku: string;
  name: string;
  sizeLabel: string;
  quantity: number;
  rowTotal: number;
};
type Cart = { id: string; items: CartItem[]; grandTotal: number; currency: string };

const kr = (n: number) => n.toLocaleString("is-IS").replace(/,/g, ".") + " kr.";

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/cart");
      if (!res.ok) throw new Error();
      setCart(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }
  useEffect(() => { load(); }, []);

  async function mutate(method: "PATCH" | "DELETE", body: object) {
    setBusy(true);
    try {
      await fetch("/api/cart", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
      window.dispatchEvent(new Event("tk-cart-changed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex-1 flex flex-col items-center justify-center px-[6vw] pt-24 pb-14 text-center">
      <Link href="/" className="mb-4 text-[0.75rem] tracking-[0.22em] uppercase" style={{ color: "var(--muted)" }}>
        ← Halda áfram að versla
      </Link>

      <div
        className="relative w-full max-w-[520px] rounded-md border p-7 md:p-10 overflow-hidden flex flex-col"
        style={{
          background: "linear-gradient(180deg, var(--black-3), var(--black-2))",
          borderColor: "rgba(212,175,55,.22)",
          maxHeight: "calc(100dvh - 180px)",
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: "linear-gradient(90deg, transparent, var(--gold), transparent)" }} />

        <h1 className="uppercase font-extrabold tracking-[0.2em] text-xl mb-4">
          Karfan <span style={{ color: "var(--gold)" }}>þín</span>
        </h1>

        <div className="overflow-y-auto flex-1 min-h-0">
          {error && <p className="py-8" style={{ color: "var(--muted)" }}>Ekki næst samband við körfuna í augnablikinu.</p>}
          {!error && !cart && <p className="py-8" style={{ color: "var(--muted)" }}>Sæki körfuna…</p>}
          {cart && !cart.items.length && (
            <p className="py-8" style={{ color: "var(--muted)" }}>Karfan er tóm — veldu stærð á forsíðunni.</p>
          )}
          {cart?.items.map((item) => (
            <div key={item.uid} className="flex items-center gap-3 py-3 text-left border-b"
              style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[0.9rem]">{item.name}</div>
                {item.sizeLabel && (
                  <div className="text-[0.75rem] tracking-[0.1em] mt-0.5" style={{ color: "var(--muted)" }}>
                    Stærð {item.sizeLabel}
                  </div>
                )}
              </div>
              <span className="flex items-center gap-2">
                <button disabled={busy || item.quantity <= 1}
                  onClick={() => mutate("PATCH", { uid: item.uid, qty: item.quantity - 1 })}
                  className="w-8 h-8 rounded-lg cursor-pointer disabled:opacity-40"
                  style={{ border: "1px solid var(--gold-dim)", color: "var(--gold-bright)", background: "transparent" }}>−</button>
                <span className="min-w-5 text-center font-bold text-[0.95rem]">{item.quantity}</span>
                <button disabled={busy}
                  onClick={() => mutate("PATCH", { uid: item.uid, qty: item.quantity + 1 })}
                  className="w-8 h-8 rounded-lg cursor-pointer disabled:opacity-40"
                  style={{ border: "1px solid var(--gold-dim)", color: "var(--gold-bright)", background: "transparent" }}>+</button>
              </span>
              <span className="min-w-[86px] text-right font-bold text-[0.9rem]">{kr(item.rowTotal)}</span>
              <button disabled={busy} onClick={() => mutate("DELETE", { uid: item.uid })}
                title="Fjarlægja" className="p-1 cursor-pointer text-lg disabled:opacity-40"
                style={{ color: "var(--muted)", background: "none", border: "none" }}>✕</button>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center pt-4 pb-1">
          <span className="text-[0.72rem] tracking-[0.2em] uppercase" style={{ color: "var(--muted)" }}>Samtals</span>
          <span className="font-extrabold text-xl" style={{ color: "var(--gold-bright)" }}>
            {cart?.items.length ? kr(cart.grandTotal) : "—"}
          </span>
        </div>

        <label className="flex items-center justify-center gap-2.5 my-3.5 text-[0.78rem]" style={{ color: "var(--muted)" }}>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
            className="w-4 h-4 cursor-pointer" style={{ accentColor: "var(--gold)" }} />
          <span>
            Ég samþykki{" "}
            <Link href="/skilmalar" target="_blank" style={{ color: "var(--gold)" }}>skilmálana</Link>
          </span>
        </label>

        <button className="btn-gold w-full" disabled={!cart?.items.length || !accepted}
          onClick={() => router.push("/afgreidsla")}>
          Ganga frá pöntun
        </button>
        <p className="mt-2.5 text-[0.7rem] tracking-[0.08em]" style={{ color: "var(--muted)" }}>
          Greiðslan fer fram á öruggri greiðslusíðu
        </p>
      </div>
    </section>
  );
}
