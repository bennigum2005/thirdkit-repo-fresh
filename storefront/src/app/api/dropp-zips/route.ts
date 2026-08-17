// src/app/api/dropp-zips/route.ts
// "Does Dropp home-deliver to this postcode?" — the same check Dropp's own
// plugins run (deliveryzips list). The browser uses this to grey the
// heimsending option out early; the checkout API re-checks server-side.
import { NextRequest } from "next/server";
import { homeDeliveryAvailable } from "@/lib/dropp";

export async function GET(request: NextRequest) {
  const postcode = request.nextUrl.searchParams.get("postcode")?.trim() ?? "";
  if (!/^\d{3}$/.test(postcode)) {
    return Response.json({ error: "INVALID_POSTCODE" }, { status: 400 });
  }
  const result = await homeDeliveryAvailable(postcode);
  return Response.json(result);
}
