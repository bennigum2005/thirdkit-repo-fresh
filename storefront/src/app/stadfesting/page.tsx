"use client";
// Confirmation page — a COURTESY, not a mechanism (course ch. 7). It polls the
// completion endpoint and shows the result; the webhook already did the work.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Status = { status: "pending" | "placed" | "failed" | "unknown"; orderNumber?: string };

function ConfirmationInner() {
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";
  const [result, setResult] = useState<Status>({ status: "pending" });

  useEffect(() => {
    let tries = 0;
    let stopped = false;
    async function poll() {
      if (stopped || tries++ > 30) return;
      try {
        const res = await fetch(`/api/order-status?ref=${encodeURIComponent(ref)}`);
        const data: Status = await res.json();
        setResult(data);
        if (data.status === "placed" || data.status === "failed") {
          // Order done — the old cart is inactive; touching /api/cart lets the
          // server hand out a fresh one so the badge resets (course ch. 5).
          fetch("/api/cart").finally(() =>
            window.dispatchEvent(new Event("tk-cart-changed"))
          );
          return;
        }
      } catch {}
      setTimeout(poll, 1000);
    }
    if (ref) poll();
    return () => { stopped = true; };
  }, [ref]);

  return (
    <section className="flex-1 flex flex-col items-center justify-center px-[6vw] pt-24 pb-14 text-center">
      <div
        className="relative w-full max-w-[460px] rounded-md border p-8 md:p-12 overflow-hidden"
        style={{ background: "linear-gradient(180deg, var(--black-3), var(--black-2))", borderColor: "rgba(212,175,55,.22)" }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: "linear-gradient(90deg, transparent, var(--gold), transparent)" }} />

        {result.status === "placed" ? (
          <>
            <div className="w-[88px] h-[88px] rounded-full mx-auto mb-7 flex items-center justify-center text-4xl"
              style={{ border: "2px solid var(--gold)", color: "var(--gold-bright)", boxShadow: "0 0 40px rgba(212,175,55,.18)" }}>
              ✓
            </div>
            <h1 className="uppercase font-extrabold tracking-[0.1em] text-3xl">
              Takk <span style={{ color: "var(--gold)" }}>fyrir!</span>
            </h1>
            <p className="mt-4 text-[0.95rem] leading-relaxed" style={{ color: "var(--muted)" }}>
              Greiðslan tókst og pöntunin þín er staðfest. Kvittun er á leiðinni í tölvupóstinn þinn.
            </p>
            {result.orderNumber && (
              <p className="mt-3 text-[0.8rem] tracking-[0.1em]" style={{ color: "var(--gold-bright)" }}>
                Pöntunarnúmer: {result.orderNumber}
              </p>
            )}
          </>
        ) : result.status === "failed" ? (
          <>
            <h1 className="uppercase font-extrabold tracking-[0.1em] text-2xl">Smá hökt</h1>
            <p className="mt-4 text-[0.95rem] leading-relaxed" style={{ color: "var(--muted)" }}>
              Greiðslan barst en staðfestingin er enn á leiðinni. Ekki borga aftur —
              pöntunin skilar sér, og kvittun kemur í tölvupósti.
            </p>
          </>
        ) : (
          <>
            <h1 className="uppercase font-extrabold tracking-[0.1em] text-2xl">Augnablik…</h1>
            <p className="mt-4 text-[0.95rem]" style={{ color: "var(--muted)" }}>
              Staðfesti pöntunina þína.
            </p>
          </>
        )}

        <Link href="/" className="btn-gold inline-block w-full mt-8">Aftur á forsíðu</Link>
      </div>
    </section>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense>
      <ConfirmationInner />
    </Suspense>
  );
}
