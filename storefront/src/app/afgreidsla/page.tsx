"use client";
// Checkout page in three steps: info → delivery choice (Dropp & co., straight
// from Magento) → summary. Totals always come from the server, never from here.
import { useEffect, useState } from "react";
import Link from "next/link";

type CartItem = { uid: string; name: string; sizeLabel: string; quantity: number; rowTotal: number };
type Cart = { items: CartItem[]; grandTotal: number };
type Method = { carrier: string; method: string; title: string; amount: number };
type DroppLocation = { id: string; name: string; address?: string };

// Dropp's embeddable location picker (same integration as their official
// WooCommerce/Shopify plugins): load the script, call chooseDroppLocation().
const DROPP_SCRIPT = "https://app.dropp.is/dropp-locations.min.js";

// The visible delivery experience is Dropp (like joiutherji.is); the Magento
// method underneath carries the price. We map raw methods to two options:
// a Dropp pickup point (widget required) and in-store pickup.
type DeliveryOption = { kind: "dropp" | "store"; label: string; method: Method };

function buildOptions(methods: Method[]): DeliveryOption[] {
  const isStore = (m: Method) => /instore|pickup|verslun/i.test(`${m.carrier} ${m.method} ${m.title}`);
  const store = methods.find(isStore);
  const delivery = methods.filter((m) => !isStore(m));
  // Prefer free shipping when Magento offers it, otherwise the cheapest
  const preferred =
    delivery.find((m) => /free/i.test(m.carrier)) ??
    [...delivery].sort((a, b) => a.amount - b.amount)[0];

  const options: DeliveryOption[] = [];
  if (preferred) options.push({ kind: "dropp", label: "Dropp — Dropp-stöð að eigin vali", method: preferred });
  if (store) options.push({ kind: "store", label: "Sækja í verslun Jóa útherja", method: store });
  // Safety: never hide everything — fall back to the raw list
  if (!options.length) return methods.map((m) => ({ kind: "store" as const, label: m.title, method: m }));
  return options;
}

let droppScriptPromise: Promise<void> | null = null;
function loadDroppScript(): Promise<void> {
  if (droppScriptPromise) return droppScriptPromise;
  droppScriptPromise = new Promise((resolve, reject) => {
    const storeId = process.env.NEXT_PUBLIC_DROPP_STORE_ID;
    const script = document.createElement("script");
    script.src = storeId ? `${DROPP_SCRIPT}?data-store-id=${encodeURIComponent(storeId)}` : DROPP_SCRIPT;
    if (storeId) script.setAttribute("data-store-id", storeId);
    script.onload = () => resolve();
    script.onerror = () => { droppScriptPromise = null; reject(new Error("dropp script failed")); };
    document.body.appendChild(script);
  });
  return droppScriptPromise;
}
type Summary = {
  shipping: Method;
  grandTotal: number;
  currency: string;
  paymentMethods: Array<{ code: string; title: string }>;
};

const kr = (n: number) => n.toLocaleString("is-IS").replace(/,/g, ".") + " kr.";

const FIELDS = [
  { key: "email", label: "Netfang", type: "email", autoComplete: "email" },
  { key: "firstName", label: "Fornafn", type: "text", autoComplete: "given-name" },
  { key: "lastName", label: "Eftirnafn", type: "text", autoComplete: "family-name" },
  { key: "address", label: "Heimilisfang", type: "text", autoComplete: "street-address" },
  { key: "postalCode", label: "Póstnúmer", type: "text", autoComplete: "postal-code" },
  { key: "phone", label: "Símanúmer", type: "tel", autoComplete: "tel" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

function errorText(data: {
  error?: string;
  detail?: string;
  unavailable?: Array<{ name: string; sizeLabel: string }>;
}): string {
  if (data.error === "OUT_OF_STOCK") {
    const what = (data.unavailable ?? [])
      .map((u) => `${u.name}${u.sizeLabel ? ` (${u.sizeLabel})` : ""}`)
      .join(", ");
    return `Því miður seldist upp á meðan: ${what || "vara í körfunni"}. Fjarlægðu línuna úr körfunni eða veldu aðra stærð.`;
  }
  switch (data.error) {
    case "EMPTY_CART": return "Karfan er tóm — veldu vöru fyrst.";
    case "NO_SHIPPING_METHODS": return "Heimilisfangið virðist ekki gilt — athugaðu póstnúmer og sveitarfélag.";
    case "INVALID_EMAIL": return "Netfangið lítur ekki rétt út.";
    case "MISSING_FIELD": return "Það vantar í reitina — fylltu alla út.";
    case "INVALID_SHIPPING": return "Veldu afhendingarmáta aftur.";
    default: return "Eitthvað fór úrskeiðis — reyndu aftur." + (data.detail ? ` [${data.detail}]` : "");
  }
}

export default function CheckoutPage() {
  const [step, setStep] = useState<"form" | "methods" | "summary">("form");
  const [cart, setCart] = useState<Cart | null>(null);
  const [form, setForm] = useState<Record<FieldKey, string>>({
    email: "", firstName: "", lastName: "", address: "", postalCode: "", phone: "",
  });
  const [options, setOptions] = useState<DeliveryOption[]>([]);
  const [picked, setPicked] = useState<DeliveryOption | null>(null);
  const [droppLoc, setDroppLoc] = useState<DroppLocation | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cart")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCart)
      .catch(() => {});
  }, []);

  async function post(payload: object) {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    return data;
  }

  async function submitInfo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post(form);
      const opts = buildOptions(data.methods as Method[]);
      setOptions(opts);
      setPicked(opts[0] ?? null); // Dropp preselected
      setStep("methods");
    } catch (data) {
      setError(errorText(data as { error?: string; detail?: string }));
    } finally {
      setBusy(false);
    }
  }

  async function pickDroppLocation() {
    setError(null);
    try {
      await loadDroppScript();
      const w = window as unknown as { chooseDroppLocation?: () => Promise<DroppLocation | undefined> };
      if (!w.chooseDroppLocation) throw new Error("chooseDroppLocation missing");
      const loc = await w.chooseDroppLocation();
      if (loc?.id) setDroppLoc({ id: loc.id, name: loc.name, address: loc.address });
    } catch {
      setError("Ekki tókst að opna Dropp-kortið — reyndu aftur.");
    }
  }

  async function confirmShipping() {
    if (!picked) return;
    if (picked.kind === "dropp" && !droppLoc) {
      setError("Veldu Dropp-afhendingarstað fyrst.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await post({
        ...form,
        shipping: { carrier: picked.method.carrier, method: picked.method.method },
        ...(picked.kind === "dropp" && droppLoc ? { droppLocation: droppLoc } : {}),
      });
      setSummary(data);
      setStep("summary");
    } catch (data) {
      setError(errorText(data as { error?: string; detail?: string }));
    } finally {
      setBusy(false);
    }
  }

  async function startPayment() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pay", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "PAYMENT_METHOD_UNAVAILABLE"
            ? "Engin greiðsluleið tiltæk á körfunni — láttu okkur vita."
            : errorText(data)
        );
        return;
      }
      window.location.href = data.redirectUrl;
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

        {step === "form" && (
          <form onSubmit={submitInfo} className="text-left">
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

            {error && <p className="mt-4 text-[0.82rem]" style={{ color: "var(--gold-bright)" }}>{error}</p>}

            <button type="submit" className="btn-gold w-full mt-6" disabled={busy || !cart?.items.length}>
              {busy ? "Augnablik…" : "Áfram í afhendingu"}
            </button>
          </form>
        )}

        {step === "methods" && (
          <div className="text-left">
            <div className="mb-3 text-[0.72rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
              Veldu afhendingarmáta
            </div>
            <div className="flex flex-col gap-2.5">
              {options.map((o) => {
                const selected = picked === o;
                return (
                  <button
                    key={o.kind + o.method.carrier + o.method.method}
                    onClick={() => setPicked(o)}
                    className="flex justify-between items-center w-full rounded-xl px-4 py-3.5 cursor-pointer text-left"
                    style={{
                      background: selected ? "linear-gradient(120deg,var(--gold),var(--gold-bright))" : "var(--black-2)",
                      color: selected ? "#0a0a0a" : "var(--text)",
                      border: selected ? "1.5px solid var(--gold-bright)" : "1.5px solid rgba(255,255,255,.18)",
                      fontWeight: selected ? 800 : 600,
                    }}
                  >
                    <span className="text-[0.92rem]">{o.label}</span>
                    <span className="text-[0.92rem]">{o.method.amount === 0 ? "Frítt" : kr(o.method.amount)}</span>
                  </button>
                );
              })}
            </div>

            {picked?.kind === "dropp" && (
              <div className="mt-5">
                <div className="mb-2 text-[0.72rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
                  Dropp-afhendingarstaður
                </div>
                {droppLoc ? (
                  <div className="flex justify-between items-center rounded-xl px-4 py-3.5"
                    style={{ background: "var(--black-2)", border: "1.5px solid var(--gold-dim)" }}>
                    <span className="text-[0.9rem]">
                      <span className="font-bold">{droppLoc.name}</span>
                      {droppLoc.address && <span style={{ color: "var(--muted)" }}> — {droppLoc.address}</span>}
                    </span>
                    <button onClick={pickDroppLocation} className="text-[0.72rem] tracking-[0.16em] uppercase cursor-pointer"
                      style={{ background: "none", border: "none", color: "var(--gold)" }}>
                      Breyta
                    </button>
                  </div>
                ) : (
                  <button onClick={pickDroppLocation} className="w-full rounded-xl px-4 py-3.5 cursor-pointer font-bold text-[0.9rem]"
                    style={{ background: "var(--black-2)", border: "1.5px dashed var(--gold-dim)", color: "var(--gold-bright)" }}>
                    Veldu Dropp-afhendingarstað á korti
                  </button>
                )}
              </div>
            )}

            {error && <p className="mt-4 text-[0.82rem]" style={{ color: "var(--gold-bright)" }}>{error}</p>}

            <button className="btn-gold w-full mt-6" onClick={confirmShipping}
              disabled={busy || !picked || (picked.kind === "dropp" && !droppLoc)}>
              {busy ? "Augnablik…" : "Áfram"}
            </button>
            <button className="w-full mt-3 text-[0.75rem] tracking-[0.2em] uppercase cursor-pointer"
              style={{ background: "none", border: "none", color: "var(--muted)" }}
              onClick={() => setStep("form")}>
              ← Breyta upplýsingum
            </button>
          </div>
        )}

        {step === "summary" && summary && (
          <div className="text-left">
            <div className="flex justify-between text-[0.9rem] py-1.5">
              <span style={{ color: "var(--muted)" }}>
                Sending — {picked?.kind === "dropp" ? "Dropp" : picked?.label ?? summary.shipping.title}
              </span>
              <span className="font-bold">{summary.shipping.amount === 0 ? "Frítt" : kr(summary.shipping.amount)}</span>
            </div>
            {droppLoc && picked?.kind === "dropp" && (
              <div className="text-[0.85rem] py-1" style={{ color: "var(--muted)" }}>
                Afhent í: <span style={{ color: "var(--text)" }}>{droppLoc.name}</span>
                {droppLoc.address ? ` — ${droppLoc.address}` : ""}
              </div>
            )}
            <div className="flex justify-between items-center pt-3 mt-2 border-t" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <span className="text-[0.72rem] tracking-[0.2em] uppercase" style={{ color: "var(--muted)" }}>Samtals</span>
              <span className="font-extrabold text-2xl" style={{ color: "var(--gold-bright)" }}>
                {kr(summary.grandTotal)}
              </span>
            </div>
            <p className="mt-5 text-[0.85rem] leading-relaxed" style={{ color: "var(--muted)" }}>
              {summary.paymentMethods.length > 0 &&
                `Greiðsluleiðir í boði: ${summary.paymentMethods.map((p) => p.title).join(", ")}.`}
            </p>
            {error && <p className="mt-3 text-[0.82rem]" style={{ color: "var(--gold-bright)" }}>{error}</p>}
            <button className="btn-gold w-full mt-5" onClick={startPayment} disabled={busy}>
              {busy ? "Augnablik…" : `Greiða ${kr(summary.grandTotal)}`}
            </button>
            <button className="w-full mt-3 text-[0.75rem] tracking-[0.2em] uppercase cursor-pointer"
              style={{ background: "none", border: "none", color: "var(--muted)" }}
              onClick={() => setStep("methods")}>
              ← Breyta afhendingu
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
