import { NextRequest, NextResponse } from "next/server";

/**
 * A route to the nesting service on the Orin.
 *
 * The nesting app already has one of these; this is deliberately the same URL and the same
 * env var rather than a call into that app, because a browser in cad-review cannot reach
 * another app's server action and a second hop through the gateway buys nothing.
 *
 * NOT RECORDED IN HISTORY. The portal's nesting app writes a nesting_jobs row from the
 * BROWSER after a run; a nest started here does not, so it will not appear on the history
 * page (bd 3pg). Steve hit this already — "has this gone through the system, it doesnt show
 * in the history?" — and it is the same cause, not a new one.
 */
const NESTING_SERVICE_URL =
  process.env.NESTING_SERVICE_URL ?? "http://10.0.0.74:8001";

async function forward(req: NextRequest, path: string[]) {
  const url = `${NESTING_SERVICE_URL}/api/v1/nesting/${path.join("/")}${req.nextUrl.search ?? ""}`;
  const init: RequestInit = { method: req.method, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.headers = { "Content-Type": "application/json" };
    init.body = await req.text();
  }
  try {
    const res = await fetch(url, init);
    const type = res.headers.get("content-type") ?? "application/json";
    // Preserve the filename for CSV downloads — a cut list that saves as "csv" with no
    // section in the name is the same defect the cut-file proxy had.
    const headers: Record<string, string> = { "Content-Type": type };
    const disp = res.headers.get("content-disposition");
    if (disp) headers["Content-Disposition"] = disp;
    return new NextResponse(await res.arrayBuffer(), { status: res.status, headers });
  } catch {
    return NextResponse.json(
      { error: `Could not reach the nesting service at ${NESTING_SERVICE_URL}` },
      { status: 502 });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
