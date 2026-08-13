"use client";
// Checkout page (course practice step 5): collects everything a Magento order
// needs and posts it to /api/checkout, which runs ch. 6 steps 3–7 server-side.
// The totals shown afterwards come from Magento, never from this component.
import { useEffect, useState } from "react";
import Link from "next/link";

type CartItem = { uid: string; name: string; sizeLabel: string; quantity: number; rowTotal: number };
type Cart = { items: CartItem[]; grandTotal: number };
type Summary = {
  grandTotal: number;
  currency: string;
  shipping: { title: string; amount: number };
  paymentSet: string | null;
};

const kr = (n: number) => n.toLocaleString("is-IS").replace(/,/g, ".") + " kr.";

const FIELDS = [
  { key: "email", label: "Netfang", type: "email", autoComplete: "email" },
  { key: "firstName", label: "Fornafn", type: "text", autoComplete: "given-name" },
  { key: "lastName", label: "Eftirnafn", type: "text", autoComplete: "family-name" },
  { key: "address", label: "Heimilisfang", type: "text", autoComplete: "street-address" },
  { key: "postalCode", label: "Póstnúmer", type: "text", autoComplete: "postal-code" },
  { key: "city", label: "Staður", type: "text", autoComplete: "address-level2" },
  { key: "phone", label: "Símanúmer", type: "tel", autoComplete: "tel" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export default function CheckoutPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [form, setForm] = useState<Record<FieldKey, string>>({
    email: "", firstName: "", lastName: "", address: "", postalCode: "", city: "", phone: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/cart")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCart)
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "EMPTY_CART" ? "Karfan er tóm — veldu vöru fyrst." :
          data.error === "NO_SHIPPING_METHODS" ? "Heimilisfangið virðist ekki gilt — athugaðu póstnúmer og stað." :
          data.error === "INVALID_EMAIL" ? "Netfangið lítur ekki rétt út." :
          data.error === "MISSING_FIELD" ? "Það vantar í reitina — fylltu alla út." :
          "Eitthvað fór úrskeiðis — reyndu aftur."
        );
        return;
      }
      setSummary(data);
    } catch {
      setError("Eitthvað fór úrskeiðis — reyndu aftur.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    background: "var(--black-2)",
    border: "1.5px solid rgba(255,255,255,.18)",
    color: "var(--text)",
  } as const;

  return (
    <section className="flex-1 flex flex-col items-center px-[6vw] pt-24 pb-20 overflow-y-auto">
      <Link href="/karfa" className="mb-4 text-[0.75rem] tracking-[0.22em] uppercase" style={{ color: "var(--muted)" }}>
        ← Aftur í körfuna
      </Link>

      <div
        className="relative w-full max-w-[560px] rounded-md border p-7 md:p-10 overflow-hidden"
        style={{
          background: "linear-gradient(180deg, var(--black-3), var(--black-2))",
          borderColor: "rgba(212,175,55,.22)",
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: "linear-gradient(90deg, transparent, var(--gold), transparent)" }} />

        <h1 className="uppercase font-extrabold tracking-[0.2em] text-xl mb-5 text-center">
          Afgreiðsla<span style={{ color: "var(--gold)" }}>.</span>
        </h1>

        {/* Order summary from the real Magento cart */}
        <div className="mb-6 pb-4 border-b" style={{ borderColor: "rgba(255,255,255,.08)" }}>
          {cart?.items.map((i) => (
            <div key={i.uid} className="flex justify-between text-[0.88rem] py-1">
              <span>
                {i.name}
                {i.sizeLabel ? ` — ${i.sizeLabel}` : ""} × {i.quantity}
              </span>
              <span className="font-bold">{kr(i.rowTotal)}</span>
            </div>
          ))}
          {cart && !cart.items.length && (
            <p className="text-[0.88rem]" style={{ color: "var(--muted)" }}>
              Karfan er tóm — <Link href="/" style={{ color: "var(--gold)" }}>veldu vöru fyrst</Link>.
            </p>
          )}
        </div>

        {!summary ? (
          <form onSubmit={submit} className="text-left">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <label key={f.key} className={f.key === "email" || f.key === "address" ? "md:col-span-2" : ""}>
                  <span className="block mb-1 text-[0.68rem] font-bold tracking-[0.2em] uppercase" style={{ color: "var(--muted)" }}>
                    {f.label}
                  </span>
                  <input
                    type={f.type}
                    autoComplete={f.autoComplete}
                    required
                    value={form[f.key]}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="w-full rounded-xl px-4 py-3 text-[0.95rem] outline-none focus:border-[var(--gold)]"
                    style={inputStyle}
                  />
                </label>
              ))}
            </div>

            {error && (
              <p className="mt-4 text-[0.82rem] tracking-[0.04em]" style={{ color: "var(--gold-bright)" }}>{error}</p>
            )}

            <button type="submit" className="btn-gold w-full mt-6" disabled={busy || !cart?.items.length}>
              {busy ? "Augnablik…" : "Staðfesta upplýsingar"}
            </button>
            <p className="mt-3 text-[0.7rem] text-center tracking-[0.08em]" style={{ color: "var(--muted)" }}>
              Greiðslan sjálf fer fram á öruggri greiðslusíðu í næsta skrefi
            </p>
          </form>
        ) : (
          <div className="text-left">
            <div className="flex justify-between text-[0.9rem] py-1.5">
              <span style={{ color: "var(--muted)" }}>Sending — {summary.shipping.title}</span>
              <span className="font-bold">{kr(summary.shipping.amount)}</span>
            </div>
            <div className="flex justify-between items-center pt-3 mt-2 border-t" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <span className="text-[0.72rem] tracking-[0.2em] uppercase" style={{ color: "var(--muted)" }}>Samtals</span>
              <span className="font-extrabold text-2xl" style={{ color: "var(--gold-bright)" }}>
                {kr(summary.grandTotal)}
              </span>
            </div>
            <p className="mt-5 text-[0.85rem] leading-relaxed" style={{ color: "var(--muted)" }}>
              Pöntunin er tilbúin í Magento — allt sem vantar er greiðslan.
              Greiðsluhlutinn tengist um leið og sandbox-lyklarnir eru komnir.
            </p>
            <button className="btn-gold w-full mt-5" disabled>
              Greiða {kr(summary.grandTotal)}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
