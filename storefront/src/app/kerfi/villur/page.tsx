"use client";
// Error dashboard (practice step 9). Auto-refreshes every 5 seconds — a
// deliberate failure must show up here well within the course's minute.
import { useEffect, useState } from "react";

type CapturedError = { time: string; where: string; message: string; stack?: string };

export default function ErrorDashboard() {
  const [errors, setErrors] = useState<CapturedError[] | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      if (stopped) return;
      try {
        // Forward the ?token= from the page URL — the API requires it in prod
        const token = new URLSearchParams(window.location.search).get("token");
        const res = await fetch(`/api/log-error${token ? `?token=${encodeURIComponent(token)}` : ""}`);
        if (res.ok) setErrors((await res.json()).errors);
      } catch {}
      setTimeout(load, 5000);
    }
    load();
    return () => { stopped = true; };
  }, []);

  return (
    <section className="flex-1 px-[6vw] pt-28 pb-20 max-w-[900px] mx-auto w-full overflow-y-auto">
      <h1 className="uppercase font-extrabold tracking-[0.2em] text-xl mb-1">
        Villur<span style={{ color: "var(--gold)" }}>.</span>
      </h1>
      <p className="text-[0.8rem] mb-6" style={{ color: "var(--muted)" }}>
        Nýjast efst · uppfærist á 5 sek. fresti · prófaðu /api/villa-test til að framkalla villu viljandi
      </p>

      {errors === null && <p style={{ color: "var(--muted)" }}>Sæki…</p>}
      {errors?.length === 0 && (
        <p className="text-[0.95rem]" style={{ color: "var(--muted)" }}>
          Engar villur skráðar — kerfið er hreint.
        </p>
      )}
      {errors?.map((e, i) => (
        <div key={i} className="mb-3 rounded-md border p-4 text-left"
          style={{ background: "var(--black-2)", borderColor: "rgba(255,255,255,.1)" }}>
          <div className="flex justify-between gap-4 flex-wrap">
            <span className="font-bold text-[0.85rem]" style={{ color: "var(--gold-bright)" }}>{e.where}</span>
            <span className="text-[0.72rem]" style={{ color: "var(--muted)" }}>
              {new Date(e.time).toLocaleTimeString("is-IS")}
            </span>
          </div>
          <div className="mt-1.5 text-[0.9rem]">{e.message}</div>
          {e.stack && (
            <pre className="mt-2 text-[0.7rem] overflow-x-auto" style={{ color: "var(--muted)" }}>{e.stack}</pre>
          )}
        </div>
      ))}
    </section>
  );
}
