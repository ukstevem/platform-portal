import { NextRequest, NextResponse } from "next/server";

/**
 * Thin proxy to the cad-automation service (stage3).
 *
 * The browser never calls the service directly: it is not on the platform network from a
 * user's machine, and routing through here keeps the service URL a deployment concern
 * rather than something baked into client bundles. Same shape as the nesting app's
 * /api/nesting/run proxy.
 *
 * NOTE (bd 3pg): the nesting app learned this the hard way — a proxy that only forwards
 * records nothing. Anything here that should be auditable has to be written down on the way
 * through, not assumed to be captured by the service on the other side.
 */
const CAD_SERVICE_URL =
  process.env.CAD_SERVICE_URL ?? "http://host.docker.internal:8001";

async function forward(req: NextRequest, path: string[]) {
  const search = req.nextUrl.search ?? "";
  const url = `${CAD_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    console.error("cad-review proxy failed:", url, err);
    return NextResponse.json(
      { error: "Could not reach the CAD service", url },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
