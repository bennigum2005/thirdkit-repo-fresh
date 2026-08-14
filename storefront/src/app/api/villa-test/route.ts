// src/app/api/villa-test/route.ts
// Deliberate failure for the step 9 "done when" test: hit this endpoint and
// the error must appear on /kerfi/villur within a minute. Dev only.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not available", { status: 404 });
  }
  throw new Error("Viljandi prufuvilla — skref 9 virkar ef þú sérð þetta á /kerfi/villur");
}
