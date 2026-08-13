"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function CartButton() {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    fetch("/api/cart")
      .then((r) => (r.ok ? r.json() : null))
      .then((cart) => {
        if (!alive || !cart) return;
        type Item = { quantity: number };
        setCount((cart.items as Item[]).reduce((n, i) => n + i.quantity, 0));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [pathname]);

  return (
    <Link href="/karfa" aria-label="Karfa" className="relative inline-flex items-center">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--gold)"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 7h12l1.2 12.2a1 1 0 0 1-1 1.1H5.8a1 1 0 0 1-1-1.1L6 7Z" />
        <path d="M9 10V6a3 3 0 0 1 6 0v4" />
      </svg>
      {count !== null && count > 0 && (
        <span
          className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full text-[0.65rem] font-extrabold flex items-center justify-center"
          style={{ background: "linear-gradient(120deg,var(--gold),var(--gold-bright))", color: "#0a0a0a" }}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
