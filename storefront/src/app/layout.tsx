import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";

export const metadata: Metadata = {
  title: "Third Kit",
  description: "Third Kit — svart og gull. Fullorðins- og barnastærðir.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="is">
      <body className="min-h-dvh flex flex-col">
        <header
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-end px-[6vw] py-2.5 border-b"
          style={{
            background: "rgba(10,10,10,.82)",
            backdropFilter: "blur(12px)",
            borderColor: "rgba(212,175,55,.18)",
          }}
        >
          <Link href="/">
            <Image src="/logo.png" alt="Third Kit" width={56} height={56} className="h-14 w-auto" priority />
          </Link>
        </header>

        <main className="flex-1 flex flex-col">{children}</main>

        <footer
          className="fixed bottom-0 left-0 right-0 z-40 text-center px-[6vw] py-3 text-[0.68rem] tracking-[0.14em] pointer-events-none"
          style={{ color: "var(--muted)" }}
        >
          &copy; 2026 Third Kit. Allur réttur áskilinn. &nbsp;·&nbsp;{" "}
          <Link href="/skilmalar" className="pointer-events-auto" style={{ color: "var(--gold)" }}>
            Skilmálar
          </Link>
        </footer>
      </body>
    </html>
  );
}
