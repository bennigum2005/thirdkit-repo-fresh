"use client";
// Checkout page in three steps: info → delivery choice (Dropp & co., straight
// from Magento) → summary. Totals always come from the server, never from here.
import { useEffect, useState } from "react";
import Link from "next/link";

type CartItem = { uid: string; name: string; sizeLabel: string; quantity: number; rowTotal: number };
type Cart = { items: CartItem[]; grandTotal: number };
type Method = { carrier: string; method: string; title: string; amount: number };
type DroppLocation = { id: string; name: string; address?: string; lat?: number; lng?: number };

/** Great-circle distance in km (haversine) — fine at Iceland scale. */
function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function distLabel(km: number): string {
  return km < 1
    ? `${Math.round(km * 1000)} m`
    : `${km.toFixed(1).replace(".", ",")} km`;
}

/** Accent-insensitive contains-match so „Skeifan" finnst með „skeifan". */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ð/g, "d").replace(/þ/g, "th").replace(/æ/g, "ae");
}

// Dropp's embeddable location picker (same integration as their official
// WooCommerce/Shopify plugins): load the script, call chooseDroppLocation().
const DROPP_SCRIPT = "https://app.dropp.is/dropp-locations.min.js";

// The visible delivery experience is Dropp (like joiutherji.is); the Magento
// method underneath carries the price. Raw methods map to two options:
// Dropp pickup point (widget required) and Dropp home delivery.
type DeliveryOption = { kind: "dropp" | "home" | "store"; label: string; method: Method };

function buildOptions(methods: Method[]): DeliveryOption[] {
  const isStore = (m: Method) => /instore|pickup|verslun/i.test(`${m.carrier} ${m.method} ${m.title}`);
  const delivery = methods.filter((m) => !isStore(m));
  const free = delivery.find((m) => /free/i.test(m.carrier));
  const cheapest = [...delivery].sort((a, b) => a.amount - b.amount)[0];
  const paid = [...delivery].filter((m) => !/free/i.test(m.carrier)).sort((a, b) => a.amount - b.amount)[0];

  const pickupMethod = free ?? cheapest; // free-over-threshold applies to Dropp points
  const homeMethod = paid ?? cheapest;   // home delivery keeps its price

  const options: DeliveryOption[] = [];
  if (pickupMethod) options.push({ kind: "dropp", label: "Dropp afhendingarstaður", method: pickupMethod });
  if (homeMethod) options.push({ kind: "home", label: "Dropp heimsending", method: homeMethod });
  if (!options.length) return methods.map((m) => ({ kind: "store" as const, label: m.title, method: m }));
  return options;
}

function OptionIcon({ kind }: { kind: DeliveryOption["kind"] }) {
  const stroke = "currentColor";
  if (kind === "dropp")
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 7h13v9H1zM14 10h4l4 3v3h-8" /><circle cx="6" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" />
      </svg>
    );
  if (kind === "home")
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />
      </svg>
    );
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h16l-1 4a3 3 0 0 1-3 2H8a3 3 0 0 1-3-2L4 8Z" /><path d="M5 14v6h14v-6" /><path d="M6 8 8 4h8l2 4" />
    </svg>
  );
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
  reason?: string;
  postcode?: string;
  unavailable?: Array<{ name: string; sizeLabel: string }>;
}): string {
  if (data.error === "ADDRESS_NOT_FOUND") {
    return data.reason === "NUMBER"
      ? "Húsnúmerið finnst ekki við þessa götu — athugaðu heimilisfangið."
      : `Þessi gata finnst ekki í póstnúmeri ${data.postcode ?? ""} — athugaðu heimilisfangið.`;
  }
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
    case "INVALID_POSTCODE": return "Þetta póstnúmer er ekki til — athugaðu heimilisfangið.";
    case "HOME_DELIVERY_UNAVAILABLE":
      return "Dropp heimsending er ekki í boði fyrir þetta póstnúmer — veldu Dropp afhendingarstað í staðinn.";
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
  const [droppList, setDroppList] = useState<DroppLocation[] | null>(null);
  const [droppListFailed, setDroppListFailed] = useState(false);
  const [droppQuery, setDroppQuery] = useState("");
  // Browser geolocation → distance-sorted pickup list. "denied" falls back to search.
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "asking" | "ok" | "denied">("idle");
  const [droppOpen, setDroppOpen] = useState(false);
  // null = still checking; true/false = Dropp's deliveryzips answer
  const [homeAvailable, setHomeAvailable] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cart")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCart)
      .catch(() => {});
    // Warm the address registry so validation is instant when the form submits
    fetch("/api/address-check?warm=1").catch(() => {});
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
      // Dropp's own rule: heimsending only exists for postcodes on their
      // deliveryzips list — grey the option out right away if not.
      setHomeAvailable(null);
      fetch(`/api/dropp-zips?postcode=${encodeURIComponent(form.postalCode.trim())}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((z) => setHomeAvailable(z ? Boolean(z.available) : true))
        .catch(() => setHomeAvailable(true)); // never block on an outage
    } catch (data) {
      setError(errorText(data as { error?: string; detail?: string }));
    } finally {
      setBusy(false);
    }
  }

  // If heimsending turns out not to exist for the postcode while it's the
  // selected option, snap back to the Dropp pickup-point option.
  useEffect(() => {
    if (homeAvailable === false && picked?.kind === "home") {
      setPicked(options.find((o) => o.kind === "dropp") ?? null);
    }
  }, [homeAvailable, picked, options]);

  // Load the full pickup-point list once, first time Dropp is the chosen kind.
  useEffect(() => {
    if (picked?.kind !== "dropp" || droppList !== null || droppListFailed) return;
    fetch("/api/dropp-locations")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setDroppList((data.locations ?? []) as DroppLocation[]))
      .catch(() => setDroppListFailed(true)); // fall back to the map widget
  }, [picked, droppList, droppListFailed]);

  // Ask for the shopper's location once the Dropp option is active
  useEffect(() => {
    if (picked?.kind !== "dropp" || geoStatus !== "idle") return;
    if (!("geolocation" in navigator)) { setGeoStatus("denied"); return; }
    setGeoStatus("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("ok");
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 }
    );
  }, [picked, geoStatus]);

  // One list for the dropdown: filtered by the search text, sorted by
  // distance when we know where the shopper is, alphabetically otherwise.
  const droppDisplay = (() => {
    if (!droppList) return [];
    const q = droppQuery.trim();
    const base = q.length >= 2
      ? droppList.filter((l) => norm(`${l.name} ${l.address ?? ""}`).includes(norm(q)))
      : droppList;
    // The shopper's own postcode (from the form) comes first, then the rest —
    // each group sorted by distance when we have a position.
    const myPost = form.postalCode.trim();
    const withKm = base.map((l) => ({
      ...l,
      km:
        userPos && typeof l.lat === "number" && typeof l.lng === "number"
          ? distKm(userPos.lat, userPos.lng, l.lat, l.lng)
          : null,
      inMyPost: myPost.length === 3 && (l.address ?? "").includes(myPost) ? 0 : 1,
    }));
    withKm.sort((a, b) => {
      if (a.inMyPost !== b.inMyPost) return a.inMyPost - b.inMyPost;
      if (a.km !== null && b.km !== null) return a.km - b.km;
      if (a.km !== null) return -1;
      if (b.km !== null) return 1;
      return a.name.localeCompare(b.name, "is");
    });
    return withKm.slice(0, 30);
  })();

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
        deliveryKind: picked.kind,
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
            <div className="mb-3 text-[0.95rem] font-bold" style={{ color: "var(--text)" }}>
              Afhendingarmáti
            </div>
            <div className="flex flex-col gap-2.5">
              {options.map((o) => {
                const disabled = o.kind === "home" && homeAvailable === false;
                const selected = picked === o && !disabled;
                return (
                  <button
                    key={o.kind + o.method.carrier + o.method.method}
                    onClick={() => !disabled && setPicked(o)}
                    disabled={disabled}
                    className="flex items-center gap-3 w-full rounded-xl px-4 py-3.5 text-left"
                    style={{
                      background: selected ? "rgba(212,175,55,.10)" : "var(--black-2)",
                      color: "var(--text)",
                      border: selected ? "1.5px solid var(--gold)" : "1.5px solid rgba(255,255,255,.18)",
                      opacity: disabled ? 0.45 : 1,
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <span className="w-[18px] h-[18px] rounded-full flex-shrink-0 flex items-center justify-center"
                      style={{ border: selected ? "2px solid var(--gold)" : "2px solid rgba(255,255,255,.35)" }}>
                      {selected && <span className="w-[9px] h-[9px] rounded-full" style={{ background: "var(--gold)" }} />}
                    </span>
                    <span className="flex-1 text-[0.95rem]" style={{ fontWeight: selected ? 700 : 500 }}>
                      {o.label}
                      <span className="block text-[0.78rem] mt-0.5" style={{ color: "var(--muted)" }}>
                        {disabled
                          ? `Ekki í boði fyrir póstnúmer ${form.postalCode.trim()}`
                          : o.method.amount === 0 ? "Frítt" : kr(o.method.amount)}
                      </span>
                    </span>
                    {o.kind !== "store" && (
                      <span className="font-extrabold lowercase text-[1.05rem] tracking-tight flex-shrink-0">dropp</span>
                    )}
                    <span className="flex-shrink-0" style={{ color: selected ? "var(--gold-bright)" : "var(--muted)" }}>
                      <OptionIcon kind={o.kind} />
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[0.82rem] leading-relaxed" style={{ color: "var(--muted)" }}>
              Ef þú verslar yfir {kr(Number(process.env.NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD ?? 15000))} bjóðum
              við þér að senda pakkann frítt á næsta Dropp afhendingarstað!
            </p>

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
                    <button onClick={() => { setDroppLoc(null); setDroppQuery(""); setDroppOpen(true); }}
                      className="text-[0.72rem] tracking-[0.16em] uppercase cursor-pointer"
                      style={{ background: "none", border: "none", color: "var(--gold)" }}>
                      Breyta
                    </button>
                  </div>
                ) : droppListFailed ? (
                  // Location list unreachable — the map widget still works
                  <button onClick={pickDroppLocation} className="w-full rounded-xl px-4 py-3.5 cursor-pointer font-bold text-[0.9rem]"
                    style={{ background: "var(--black-2)", border: "1.5px dashed var(--gold-dim)", color: "var(--gold-bright)" }}>
                    Veldu Dropp-afhendingarstað á korti
                  </button>
                ) : (
                  <div>
                    {/* Dropdown trigger with a chevron */}
                    <button
                      onClick={() => setDroppOpen((o) => !o)}
                      disabled={droppList === null}
                      className="flex items-center justify-between w-full rounded-xl px-4 py-3.5 cursor-pointer text-[0.95rem]"
                      style={{
                        background: "var(--black-2)",
                        border: droppOpen ? "1.5px solid var(--gold)" : "1.5px solid rgba(255,255,255,.18)",
                        color: droppList === null ? "var(--muted)" : "var(--text)",
                      }}
                    >
                      <span>{droppList === null ? "Sæki afhendingarstaði…" : "Veldu Dropp-afhendingarstað"}</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: droppOpen ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--gold)" }}>
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>

                    {droppOpen && droppList && (
                      <div className="mt-2 rounded-xl p-2"
                        style={{ background: "var(--black-2)", border: "1.5px solid rgba(255,255,255,.14)" }}>
                        <input
                          type="text"
                          value={droppQuery}
                          onChange={(e) => setDroppQuery(e.target.value)}
                          placeholder="Sía eftir nafni eða stað…"
                          className="w-full rounded-lg px-3 py-2.5 mb-2 text-[0.9rem] outline-none focus:border-[var(--gold)]"
                          style={inputStyle}
                        />
                        {geoStatus === "asking" && (
                          <p className="text-[0.78rem] px-1 pb-1" style={{ color: "var(--muted)" }}>
                            Sæki staðsetningu til að raða eftir fjarlægð…
                          </p>
                        )}
                        <div className="flex flex-col gap-1 overflow-y-auto pr-1" style={{ maxHeight: 260 }}>
                          {droppDisplay.map((l) => (
                            <button key={l.id}
                              onClick={() => { setDroppLoc(l); setDroppOpen(false); setError(null); }}
                              className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-left cursor-pointer text-[0.9rem]"
                              style={{ background: "transparent", border: "none", color: "var(--text)" }}>
                              <span className="flex-1">
                                <span className="font-bold">{l.name}</span>
                                {l.address && (
                                  <span className="block text-[0.76rem] mt-0.5" style={{ color: "var(--muted)" }}>{l.address}</span>
                                )}
                              </span>
                              {l.km !== null && (
                                <span className="flex-shrink-0 text-[0.78rem] font-bold" style={{ color: "var(--gold-bright)" }}>
                                  {distLabel(l.km)}
                                </span>
                              )}
                            </button>
                          ))}
                          {!droppDisplay.length && (
                            <p className="text-[0.82rem] px-1 py-2" style={{ color: "var(--muted)" }}>
                              Enginn afhendingarstaður fannst — prófaðu annað leitarorð.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {picked?.kind === "home" && (
              <div className="mt-5">
                <div className="mb-2 text-[0.72rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
                  Sent heim á
                </div>
                <div className="rounded-xl px-4 py-3.5"
                  style={{ background: "var(--black-2)", border: "1.5px solid var(--gold-dim)" }}>
                  <span className="text-[0.9rem] font-bold">{form.address}</span>
                  <span className="block text-[0.82rem] mt-0.5" style={{ color: "var(--muted)" }}>
                    {form.postalCode}
                  </span>
                </div>
                <p className="mt-2 text-[0.78rem]" style={{ color: "var(--muted)" }}>
                  Ekki rétt? <button onClick={() => setStep("form")} className="cursor-pointer underline"
                    style={{ background: "none", border: "none", color: "var(--gold)", padding: 0 }}>
                    Breyta heimilisfangi
                  </button>
                </p>
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
