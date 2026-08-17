// src/app/api/address-check/route.ts
// ?warm=1        → start loading Staðfangaskrá into memory (called when the
//                  checkout page opens, so validation is instant on submit)
// ?address&postcode → { known, ok, reason? } for inline checks
import { NextRequest } from "next/server";
import { checkAddress, getRegistry } from "@/lib/addressRegistry";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get("warm")) {
    await getRegistry(); // resolves fast once cached
    return Response.json({ ok: true });
  }
  const address = params.get("address")?.trim() ?? "";
  const postcode = params.get("postcode")?.trim() ?? "";
  if (!address || !/^\d{3}$/.test(postcode)) {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  return Response.json(await checkAddress(address, postcode));
}
