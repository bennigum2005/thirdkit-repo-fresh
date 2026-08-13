"use client";
// Intro video overlay — plays once per visit, fades into the page.
import { useEffect, useRef, useState } from "react";

export function Intro() {
  const [state, setState] = useState<"init" | "playing" | "fading" | "gone">("init");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("tk-intro") === "1"; } catch {}
    if (seen) { setState("gone"); return; }
    setState("playing");
  }, []);

  useEffect(() => {
    if (state !== "playing") return;
    const video = videoRef.current;
    if (!video) return;

    const end = () => {
      try { sessionStorage.setItem("tk-intro", "1"); } catch {}
      setState("fading");
      setTimeout(() => setState("gone"), 2100);
    };

    video.addEventListener("ended", end);
    video.addEventListener("error", end);
    const p = video.play();
    if (p && p.catch) p.catch(end);
    const safety = setTimeout(end, 12000);
    return () => {
      video.removeEventListener("ended", end);
      video.removeEventListener("error", end);
      clearTimeout(safety);
    };
  }, [state]);

  if (state === "gone" || state === "init") return null;

  const end = () => {
    try { sessionStorage.setItem("tk-intro", "1"); } catch {}
    setState("fading");
    setTimeout(() => setState("gone"), 2100);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black transition-opacity duration-[2000ms]"
      style={{ opacity: state === "fading" ? 0 : 1, pointerEvents: state === "fading" ? "none" : "auto" }}
    >
      <video ref={videoRef} src="/intro.mp4" muted playsInline preload="auto"
        className="w-full h-full object-cover" />
      <button
        onClick={end}
        className="absolute bottom-8 right-8 px-5 py-2.5 rounded-sm text-[0.72rem] font-bold tracking-[0.22em] uppercase cursor-pointer"
        style={{
          background: "rgba(10,10,10,.55)",
          color: "var(--gold-bright)",
          border: "1px solid rgba(212,175,55,.45)",
          backdropFilter: "blur(6px)",
        }}
      >
        Sleppa →
      </button>
    </div>
  );
}
