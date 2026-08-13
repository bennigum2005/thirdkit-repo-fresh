// src/middleware.ts — runs before every route (course ch. 3).
// Rate limiting, bot filtering and maintenance mode live here later;
// for now it logs every request path.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  console.log(`[req] ${request.method} ${request.nextUrl.pathname}`);
  return NextResponse.next();
}

export const config = {
  // Skip static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|mp4|svg|ico)).*)"],
};
