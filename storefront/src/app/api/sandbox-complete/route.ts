// src/app/api/sandbox-complete/route.ts
// Sandbox stand-in for the PROVIDER's server: signs a webhook and delivers it
// to our own /api/payment-webhook — exactly the path a real provider takes.
// Replaced entirely when a real provider is wired; nothing else changes.
import { NextRequest } from "next/server";
import crypto from "crypto";
import { signPayload } from "@/lib/payment";

export async function POST(request: NextRequest) {
  const { cartId, double } = (await request.json()) as { cartId?: string; double?: boolean };
  if (!cartId) return Response.json({ error: "MISSING_CART" }, { status: 400 });

  const payload = JSON.stringify({
    eventId: crypto.randomUUID(),
    cartId,
    status: "paid",
  });
  const signature = signPayload(payload);
  const webhookUrl = new URL("/api/payment-webhook", request.nextUrl.origin).toString();

  const deliver = () =>
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-payment-signature": signature },
      body: payload,
    });

  const res = await deliver();
  // Optional: simulate the provider retrying the SAME event (idempotency test)
  if (double) await deliver();

  return Response.json({ delivered: res.status });
}
