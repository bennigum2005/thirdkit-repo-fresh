// src/app/api/order-status/route.ts
// The confirmation page polls this (course ch. 7: the return page is a
// courtesy, not a mechanism — if it never loads, nothing is lost).
import { NextRequest } from "next/server";
import { getOrderResult } from "@/lib/payment";

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref");
  if (!ref) return Response.json({ status: "unknown" });
  return Response.json(getOrderResult(ref) ?? { status: "unknown" });
}
