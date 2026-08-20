"use client";
// ONE-PAGE checkout, joiutherji.is layout in the Third Kit theme:
// left — personal info, address, delivery (Dropp), payment (Verifone), billing;
// right — order summary with discount code and live totals.
// Totals are always computed by the SERVER; this page only displays them.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type CartItem = { uid: string; name: string; sizeLabel: string; quantity: number; rowTotal: number };
type Cart = { items: CartItem[]; grandTotal: number };
type DroppLocation = { id: string; name: string; address?: string; lat?: number; lng?: number };
type ShipInfo = { pickup: number; home: number; homeAvailable: boolean; subtotal: number };

const DROPP_SCRIPT = "https://app.dropp.is/dropp-locations.min.js";

/** Accent-insensitive contains-match so „Skeifan" finnst með „skeifan". */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ð/g, "d").replace(/þ/g, "th").replace(/æ/g, "ae");
}

function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function distLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace(".", ",")} km`;
}

// Fallback anchor when geolocation is declined: centre of the postcode's town
const POSTCODE_ANCHORS: Array<[number, number, number, number]> = [
  [100, 162, 64.135, -21.895], [170, 172, 64.155, -21.995], [190, 191, 63.966, -22.375],
  [200, 206, 64.11, -21.9], [210, 212, 64.088, -21.923], [220, 225, 64.067, -21.95],
  [230, 262, 63.998, -22.56], [270, 277, 64.167, -21.7], [300, 302, 64.322, -22.07],
  [310, 321, 64.54, -21.92], [340, 356, 65.07, -22.73], [360, 361, 64.92, -23.25],
  [370, 381, 65.11, -21.77], [400, 431, 66.075, -23.13], [450, 471, 65.59, -23.96],
  [500, 531, 65.395, -20.94], [540, 546, 65.66, -20.28], [550, 570, 65.75, -19.64],
  [580, 581, 66.15, -18.91], [600, 616, 65.68, -18.09], [620, 631, 65.97, -18.53],
  [640, 661, 66.045, -17.34], [670, 691, 66.3, -16.45], [700, 701, 65.26, -14.39],
  [710, 741, 65.15, -13.9], [750, 766, 64.93, -14.01], [780, 786, 64.25, -15.21],
  [800, 816, 63.93, -21.0], [820, 851, 63.93, -20.6], [860, 861, 63.75, -20.23],
  [870, 881, 63.42, -19.01], [900, 903, 63.44, -20.27],
];

function anchorForPostcode(pc: string): { lat: number; lng: number } | null {
  const n = parseInt(pc, 10);
  if (isNaN(n)) return null;
  for (const [from, to, lat, lng] of POSTCODE_ANCHORS) {
    if (n >= from && n <= to) return { lat, lng };
  }
  return null;
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

const kr = (n: number) => n.toLocaleString("is-IS").replace(/,/g, ".") + " kr.";

type FieldKey = "email" | "firstName" | "lastName" | "address" | "postalCode" | "phone";

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
    case "NO_SHIPPING_METHODS": return "Heimilisfangið virðist ekki gilt — athugaðu póstnúmerið.";
    case "INVALID_EMAIL": return "Netfangið lítur ekki rétt út.";
    case "MISSING_FIELD": return "Það vantar í reitina — fylltu alla út.";
    case "INVALID_SHIPPING": return "Veldu afhendingarmáta og Dropp-stað.";
    case "INVALID_POSTCODE": return "Þetta póstnúmer er ekki til — athugaðu heimilisfangið.";
    case "HOME_DELIVERY_UNAVAILABLE":
      return "Dropp heimsending er ekki í boði fyrir þetta póstnúmer — veldu Dropp afhendingarstað í staðinn.";
    case "SHIPPING_PRICE_FAILED":
      return "Ekki tókst að skrá sendingarverðið — reyndu aftur eftir augnablik.";
    case "PAYMENT_METHOD_UNAVAILABLE":
      return "Engin greiðsluleið tiltæk á körfunni — láttu okkur vita.";
    default: return "Eitthvað fór úrskeiðis — reyndu aftur." + (data.detail ? ` [${data.detail}]` : "");
  }
}

const sectionTitle = "text-[1.05rem] font-bold mb-3 mt-8 first:mt-0";

export default function CheckoutPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [form, setForm] = useState<Record<FieldKey, string>>({
    email: "", firstName: "", lastName: "", address: "", postalCode: "", phone: "",
  });
  const [picked, setPicked] = useState<"dropp" | "home">("dropp");
  const [droppLoc, setDroppLoc] = useState<DroppLocation | null>(null);
  const [droppList, setDroppList] = useState<DroppLocation[] | null>(null);
  const [droppListFailed, setDroppListFailed] = useState(false);
  const [droppOpen, setDroppOpen] = useState(false);
  const [droppQuery, setDroppQuery] = useState("");
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "asking" | "ok" | "denied">("idle");
  const [ship, setShip] = useState<ShipInfo | null>(null);
  const [coupon, setCoupon] = useState("");
  const [couponState, setCouponState] = useState<"none" | "busy" | "applied" | "invalid">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load cart + Dropp locations + warm the address registry once
  useEffect(() => {
    fetch("/api/cart").then((r) => (r.ok ? r.json() : null)).then(setCart).catch(() => {});
    fetch("/api/address-check?warm=1").catch(() => {});
    fetch("/api/dropp-locations")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setDroppList((data.locations ?? []) as DroppLocation[]))
      .catch(() => setDroppListFailed(true));
  }, []);

  // Live shipping price whenever the postcode is complete (and after coupons)
  useEffect(() => {
    if (!/^\d{3}$/.test(form.postalCode.trim())) { setShip(null); return; }
    if (shipTimer.current) clearTimeout(shipTimer.current);
    shipTimer.current = setTimeout(() => {
      fetch(`/api/shipping-price?postcode=${encodeURIComponent(form.postalCode.trim())}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setShip(d as ShipInfo))
        .catch(() => {});
    }, 350);
  }, [form.postalCode, cart]);

  // Home delivery doesn't exist for this postcode → snap back to pickup
  useEffect(() => {
    if (ship && !ship.homeAvailable && picked === "home") setPicked("dropp");
  }, [ship, picked]);

  // Geolocation the first time the location dropdown opens
  useEffect(() => {
    if (!droppOpen || geoStatus !== "idle") return;
    if (!("geolocation" in navigator)) { setGeoStatus("denied"); return; }
    setGeoStatus("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoStatus("ok"); },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 }
    );
  }, [droppOpen, geoStatus]);

  // Distance-ordered list: GPS → dropp point in own postcode → town centre
  const droppDisplay = (() => {
    if (!droppList) return [];
    const q = droppQuery.trim();
    const base = q.length >= 2
      ? droppList.filter((l) => norm(`${l.name} ${l.address ?? ""}`).includes(norm(q)))
      : droppList;
    const myPost = form.postalCode.trim();
    const pos =
      userPos ??
      (() => {
        const inPost = droppList.find(
          (l) => (l.address ?? "").includes(myPost) && typeof l.lat === "number" && typeof l.lng === "number"
        );
        return inPost ? { lat: inPost.lat!, lng: inPost.lng! } : anchorForPostcode(myPost);
      })();
    const withKm = base.map((l) => ({
      ...l,
      km: pos && typeof l.lat === "number" && typeof l.lng === "number"
        ? distKm(pos.lat, pos.lng, l.lat, l.lng) : null,
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

  async function applyCoupon() {
    if (!coupon.trim()) return;
    setCouponState("busy");
    try {
      const res = await fetch("/api/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: coupon }),
      });
      const data = await res.json();
      if (!res.ok) { setCouponState("invalid"); return; }
      setCart(data.cart);
      setCouponState("applied");
    } catch {
      setCouponState("invalid");
    }
  }

  async function removeCoupon() {
    setCouponState("busy");
    try {
      const res = await fetch("/api/coupon", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) setCart(data.cart);
    } finally {
      setCoupon("");
      setCouponState("none");
    }
  }

  async function klaraPontun() {
    setError(null);
    // client-side pre-checks (the server re-validates everything)
    for (const k of ["email", "firstName", "lastName", "address", "postalCode", "phone"] as FieldKey[]) {
      if (!form[k].trim()) { setError("Það vantar í reitina — fylltu alla út."); return; }
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError("Netfangið lítur ekki rétt út."); return; }
    if (picked === "dropp" && !droppLoc) { setError("Veldu Dropp-afhendingarstað fyrst."); return; }

    setBusy(true);
    try {
      // Steps 3–7 on the server: address, stock, setDroppOnCart, method, totals
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          shipping: { carrier: "auto", method: "auto" },
          deliveryKind: picked,
          ...(picked === "dropp" && droppLoc ? { droppLocation: droppLoc } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(errorText(data)); return; }

      // Payment session (Verifone hosted checkout / sandbox) and off we go
      const pay = await fetch("/api/pay", { method: "POST" });
      const payData = await pay.json();
      if (!pay.ok) { setError(errorText(payData)); return; }
      window.location.href = payData.redirectUrl;
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
  const inputCls = "w-full rounded-xl px-4 py-3 text-[0.95rem] outline-none focus:border-[var(--gold)]";

  const subtotal = cart ? cart.items.reduce((s, i) => s + i.rowTotal, 0) : 0;
  const discount = cart ? Math.max(0, subtotal - cart.grandTotal) : 0;
  const shipPrice = ship ? (picked === "dropp" ? ship.pickup : ship.home) : null;
  const total = cart ? cart.grandTotal + (shipPrice ?? 0) : 0;

  return (
    <section className="flex-1 px-[5vw] pt-24 pb-20 overflow-y-auto">
      <div className="grid md:grid-cols-[1fr_400px] gap-10 xl:gap-16 w-full max-w-[1240px] mx-auto items-start">

        {/* ————— LEFT: the form ————— */}
        <div className="text-left">
          <h2 className={sectionTitle}>Persónuupplýsingar</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className={`${inputCls} md:col-span-2`} style={inputStyle} type="email" placeholder="Netfang *"
              autoComplete="email" value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
            <input className={inputCls} style={inputStyle} type="text" placeholder="Fornafn *"
              autoComplete="given-name" value={form.firstName}
              onChange={(e) => setForm((s) => ({ ...s, firstName: e.target.value }))} />
            <input className={inputCls} style={inputStyle} type="text" placeholder="Eftirnafn *"
              autoComplete="family-name" value={form.lastName}
              onChange={(e) => setForm((s) => ({ ...s, lastName: e.target.value }))} />
            <input className={`${inputCls} md:col-span-2`} style={inputStyle} type="tel" placeholder="Sími *"
              autoComplete="tel" value={form.phone}
              onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
          </div>

          <h2 className={sectionTitle}>Heimilisfang</h2>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-3">
            <input className={inputCls} style={inputStyle} type="text" placeholder="Heimilisfang *"
              autoComplete="street-address" value={form.address}
              onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))} />
            <input className={inputCls} style={inputStyle} type="text" placeholder="Póstnúmer *"
              autoComplete="postal-code" value={form.postalCode}
              onChange={(e) => setForm((s) => ({ ...s, postalCode: e.target.value }))} />
          </div>

          <h2 className={sectionTitle}>Afhendingarmáti</h2>
          <div className="flex flex-col gap-2.5">
            {([
              { kind: "dropp" as const, label: "Dropp afhendingarstaður", price: ship?.pickup ?? null, disabled: false },
              {
                kind: "home" as const, label: "Dropp heimsending", price: ship?.home ?? null,
                disabled: ship ? !ship.homeAvailable : false,
              },
            ]).map((o) => {
              const selected = picked === o.kind && !o.disabled;
              return (
                <button key={o.kind}
                  onClick={() => !o.disabled && setPicked(o.kind)}
                  disabled={o.disabled}
                  className="flex items-center gap-3 w-full rounded-xl px-4 py-3.5 text-left"
                  style={{
                    background: selected ? "rgba(212,175,55,.10)" : "var(--black-2)",
                    color: "var(--text)",
                    border: selected ? "1.5px solid var(--gold)" : "1.5px solid rgba(255,255,255,.18)",
                    opacity: o.disabled ? 0.45 : 1,
                    cursor: o.disabled ? "not-allowed" : "pointer",
                  }}>
                  <span className="w-[18px] h-[18px] rounded-full flex-shrink-0 flex items-center justify-center"
                    style={{ border: selected ? "2px solid var(--gold)" : "2px solid rgba(255,255,255,.35)" }}>
                    {selected && <span className="w-[9px] h-[9px] rounded-full" style={{ background: "var(--gold)" }} />}
                  </span>
                  <span className="flex-1 text-[0.95rem]" style={{ fontWeight: selected ? 700 : 500 }}>
                    {o.label}
                    <span className="block text-[0.78rem] mt-0.5" style={{ color: "var(--muted)" }}>
                      {o.disabled
                        ? `Ekki í boði fyrir póstnúmer ${form.postalCode.trim()}`
                        : o.price === null ? "Sláðu inn póstnúmer fyrir verð"
                          : o.price === 0 ? "Frítt" : kr(o.price)}
                    </span>
                  </span>
                  <span className="font-extrabold lowercase text-[1.05rem] tracking-tight flex-shrink-0">dropp</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[0.82rem] leading-relaxed" style={{ color: "var(--muted)" }}>
            Ef þú verslar yfir {kr(Number(process.env.NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD ?? 15000))} bjóðum
            við þér að senda pakkann frítt á næsta Dropp afhendingarstað!
          </p>

          {picked === "dropp" && (
            <div className="mt-5">
              <div className="mb-2 text-[0.72rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
                Afhendingarstaðir
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
                <button onClick={pickDroppLocation} className="w-full rounded-xl px-4 py-3.5 cursor-pointer font-bold text-[0.9rem]"
                  style={{ background: "var(--black-2)", border: "1.5px dashed var(--gold-dim)", color: "var(--gold-bright)" }}>
                  Veldu Dropp-afhendingarstað á korti
                </button>
              ) : (
                <div>
                  <button
                    onClick={() => setDroppOpen((o) => !o)}
                    disabled={droppList === null}
                    className="flex items-center justify-between w-full rounded-xl px-4 py-3.5 cursor-pointer text-[0.95rem]"
                    style={{
                      background: "var(--black-2)",
                      border: droppOpen ? "1.5px solid var(--gold)" : "1.5px solid rgba(255,255,255,.18)",
                      color: droppList === null ? "var(--muted)" : "var(--text)",
                    }}>
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
                      <input type="text" value={droppQuery} onChange={(e) => setDroppQuery(e.target.value)}
                        placeholder="Sía eftir nafni eða stað…"
                        className="w-full rounded-lg px-3 py-2.5 mb-2 text-[0.9rem] outline-none focus:border-[var(--gold)]"
                        style={inputStyle} />
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

          {picked === "home" && form.address.trim() && (
            <div className="mt-5">
              <div className="mb-2 text-[0.72rem] font-bold tracking-[0.26em] uppercase" style={{ color: "var(--muted)" }}>
                Sent heim á
              </div>
              <div className="rounded-xl px-4 py-3.5"
                style={{ background: "var(--black-2)", border: "1.5px solid var(--gold-dim)" }}>
                <span className="text-[0.9rem] font-bold">{form.address}</span>
                <span className="block text-[0.82rem] mt-0.5" style={{ color: "var(--muted)" }}>{form.postalCode}</span>
              </div>
            </div>
          )}

          <h2 className={sectionTitle}>Greiðslumáti</h2>
          <div className="rounded-xl overflow-hidden"
            style={{ border: "1.5px solid var(--gold)", background: "rgba(212,175,55,.06)" }}>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="w-[18px] h-[18px] rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ border: "2px solid var(--gold)" }}>
                <span className="w-[9px] h-[9px] rounded-full" style={{ background: "var(--gold)" }} />
              </span>
              <span className="flex-1 font-bold text-[0.95rem]">Verifone Checkout</span>
              <span className="flex gap-1.5">
                {["VISA", "MC", "AMEX"].map((c) => (
                  <span key={c} className="text-[0.6rem] font-extrabold px-1.5 py-0.5 rounded"
                    style={{ background: "var(--black-2)", border: "1px solid rgba(255,255,255,.2)", color: "var(--muted)" }}>
                    {c}
                  </span>
                ))}
              </span>
            </div>
            <div className="mx-4 mb-4 rounded-lg px-4 py-5 text-center text-[0.85rem] leading-relaxed"
              style={{ background: "var(--black-2)", color: "var(--muted)" }}>
              Þegar þú smellir á „Klára pöntun" ertu send/ur á örugga greiðslusíðu
              Verifone þar sem þú lýkur kaupunum.
            </div>
          </div>

          <h2 className={sectionTitle}>Reikningsfang</h2>
          <div className="flex items-center gap-3 rounded-xl px-4 py-3.5"
            style={{ background: "rgba(212,175,55,.06)", border: "1.5px solid var(--gold)" }}>
            <span className="w-[18px] h-[18px] rounded-full flex-shrink-0 flex items-center justify-center"
              style={{ border: "2px solid var(--gold)" }}>
              <span className="w-[9px] h-[9px] rounded-full" style={{ background: "var(--gold)" }} />
            </span>
            <span className="text-[0.92rem]">Heimilisfang greiðanda er það sama og viðtakanda</span>
          </div>

          {error && <p className="mt-5 text-[0.85rem]" style={{ color: "var(--gold-bright)" }}>{error}</p>}

          <button className="btn-gold w-full mt-6" onClick={klaraPontun}
            disabled={busy || !cart?.items.length}>
            {busy ? "Augnablik…" : "Klára pöntun"}
          </button>
          <p className="mt-3 text-[0.7rem] tracking-[0.08em] text-center" style={{ color: "var(--muted)" }}>
            Með því að klára pöntun samþykkir þú <Link href="/skilmalar" style={{ color: "var(--gold)" }}>skilmála</Link> verslunarinnar
          </p>
        </div>

        {/* ————— RIGHT: order summary ————— */}
        <div className="rounded-md border p-6 md:sticky md:top-24"
          style={{
            background: "linear-gradient(180deg, var(--black-3), var(--black-2))",
            borderColor: "rgba(212,175,55,.22)",
          }}>
          <h2 className="text-[1.05rem] font-bold mb-4">Samantekt pöntunar</h2>

          {cart?.items.map((i) => (
            <div key={i.uid} className="flex items-center gap-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/box.png" alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                style={{ transform: "scale(1.0)", border: "1px solid rgba(255,255,255,.12)" }} />
              <span className="flex-1 text-[0.88rem] leading-snug">
                {i.name}
                {i.sizeLabel ? ` — ${i.sizeLabel}` : ""} × {i.quantity}
              </span>
              <span className="font-bold text-[0.9rem]">{kr(i.rowTotal)}</span>
            </div>
          ))}
          {cart && !cart.items.length && (
            <p className="text-[0.88rem]" style={{ color: "var(--muted)" }}>
              Karfan er tóm — <Link href="/" style={{ color: "var(--gold)" }}>veldu vöru fyrst</Link>.
            </p>
          )}

          <div className="flex gap-2 mt-4">
            <input className={inputCls} style={inputStyle} type="text" placeholder="Afsláttarkóði"
              value={coupon} disabled={couponState === "applied" || couponState === "busy"}
              onChange={(e) => { setCoupon(e.target.value); if (couponState === "invalid") setCouponState("none"); }} />
            {couponState === "applied" ? (
              <button onClick={removeCoupon} className="rounded-xl px-4 text-[0.75rem] tracking-[0.1em] uppercase cursor-pointer flex-shrink-0"
                style={{ background: "var(--black-2)", border: "1.5px solid var(--gold-dim)", color: "var(--gold-bright)" }}>
                Fjarlægja
              </button>
            ) : (
              <button onClick={applyCoupon} disabled={couponState === "busy" || !coupon.trim()}
                className="rounded-xl px-4 text-[0.75rem] tracking-[0.1em] uppercase cursor-pointer flex-shrink-0 disabled:opacity-40"
                style={{ background: "var(--black-2)", border: "1.5px solid rgba(255,255,255,.2)", color: "var(--text)" }}>
                {couponState === "busy" ? "…" : "Virkja"}
              </button>
            )}
          </div>
          {couponState === "invalid" && (
            <p className="mt-2 text-[0.78rem]" style={{ color: "var(--gold-bright)" }}>Kóðinn er ekki gildur.</p>
          )}
          {couponState === "applied" && (
            <p className="mt-2 text-[0.78rem]" style={{ color: "var(--gold-bright)" }}>Afsláttarkóði virkur ✓</p>
          )}

          <div className="mt-5 pt-4 border-t" style={{ borderColor: "rgba(255,255,255,.1)" }}>
            <div className="flex justify-between text-[0.88rem] py-1">
              <span style={{ color: "var(--muted)" }}>Vörur samtals:</span>
              <span>{kr(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-[0.88rem] py-1">
                <span style={{ color: "var(--muted)" }}>Afsláttur:</span>
                <span style={{ color: "var(--gold-bright)" }}>−{kr(discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[0.88rem] py-1">
              <span style={{ color: "var(--muted)" }}>Sendingarkostnaður:</span>
              <span>{shipPrice === null ? "—" : shipPrice === 0 ? "Frítt" : kr(shipPrice)}</span>
            </div>
            <div className="flex justify-between items-center pt-3 mt-2 border-t" style={{ borderColor: "rgba(255,255,255,.1)" }}>
              <span className="font-bold">Samtals:</span>
              <span className="font-extrabold text-xl" style={{ color: "var(--gold-bright)" }}>{kr(total)}</span>
            </div>
          </div>

          <Link href="/karfa" className="block mt-4 text-[0.72rem] tracking-[0.18em] uppercase text-center"
            style={{ color: "var(--muted)" }}>
            ← Breyta körfu
          </Link>
        </div>
      </div>
    </section>
  );
}
