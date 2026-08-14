"use client";
// Sandbox payment page — stands in for the provider's hosted checkout.
// The customer "pays" here; the provider's server (sandbox-complete) then
// delivers the signed webhook that actually creates the order.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Cart = { items: Array<{ uid: string }>; grandTotal: number };

const kr = (n: number) => n.toLocaleString("is-IS").replace(/,/g, ".") + " kr.";

function SandboxInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";
  const [cart, setCart] = useState<Cart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/cart")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCart)
      .catch(() => {});
  }, []);

  async function pay(double = false) {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/sandbox-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: ref, double }),
      });
      if (!res.ok) throw new Error();
      router.push(`/stadfesting?ref=${encodeURIComponent(ref)}`);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <section className="flex-1 flex flex-col items-center justify-center px-[6vw] pt-24 pb-14 text-center">
      <div
        className="relative w-full max-w-[440px] rounded-md border p-8 md:p-10 overflow-hidden"
        style={{ background: "linear-gradient(180deg, var(--black-3), var(--black-2))", borderColor: "rgba(212,175,55,.22)" }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: "linear-gradient(90deg, transparent, var(--gold), transparent)" }} />

        <div className="text-[0.68rem] font-bold tracking-[0.3em] uppercase mb-3 px-3 py-1.5 inline-block rounded-full"
          style={{ color: "var(--gold)", border: "1px solid var(--gold-dim)" }}>
          Sandbox — engin alvöru greiðsla
        </div>

        <h1 className="uppercase font-extrabold tracking-[0.2em] text-xl mb-2">Greiðslusíða</h1>
        <p className="text-[0.85rem] mb-6" style={{ color: "var(--muted)" }}>
          Hér situr hýst greiðslusíða veitunnar í framtíðinni. Upphæðin kemur frá Magento:
        </p>

        <div className="font-extrabold text-3xl mb-8" style={{ color: "var(--gold-bright)" }}>
          {cart ? kr(cart.grandTotal) : "…"}
        </div>

        {error && (
          <p className="mb-4 text-[0.82rem]" style={{ color: "var(--gold-bright)" }}>
            Ekki tókst að ljúka greiðslu — reyndu aftur.
          </p>
        )}

        <button className="btn-gold w-full" onClick={() => pay(false)} disabled={busy}>
          {busy ? "Augnablik…" : "Greiða (sandbox)"}
        </button>
        <button
          className="w-full mt-3 rounded-xl px-4 py-3 cursor-pointer text-[0.78rem] tracking-[0.1em]"
          style={{ background: "var(--black-2)", border: "1.5px solid rgba(255,255,255,.18)", color: "var(--muted)" }}
          onClick={() => pay(true)} disabled={busy}
          title="Prófar að webhookið komi tvisvar — á samt að búa til eina pöntun">
          Greiða + tvítekið webhook (idempotency-próf)
        </button>
        <button
          className="w-full mt-3 text-[0.75rem] tracking-[0.2em] uppercase cursor-pointer"
          style={{ background: "none", border: "none", color: "var(--muted)" }}
          onClick={() => router.push("/afgreidsla")} disabled={busy}>
          ← Hætta við
        </button>
      </div>
    </section>
  );
}

export default function SandboxPaymentPage() {
  return (
    <Suspense>
      <SandboxInner />
    </Suspense>
  );
}
