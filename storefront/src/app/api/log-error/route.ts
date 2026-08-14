// src/app/api/log-error/route.ts
// POST: browser errors report themselves here (client leg of step 9).
// GET: the dashboard reads the buffer. Outside development a MONITOR_TOKEN
// is required so the error log is never public.
import { NextRequest } from "next/server";
import { captureError, listErrors } from "@/lib/errorMonitor";

function authorized(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const token = process.env.MONITOR_TOKEN;
  return Boolean(token) && request.nextUrl.searchParams.get("token") === token;
}

export async function POST(request: NextRequest) {
  try {
    const { message, source } = (await request.json()) as { message?: string; source?: string };
    captureError(`browser ${String(source ?? "unknown").slice(0, 120)}`, String(message ?? "").slice(0, 500));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return new Response("Not available", { status: 404 });
  return Response.json({ errors: listErrors() });
}
