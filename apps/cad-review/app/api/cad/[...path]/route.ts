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
  const init: RequestInit = { method: req.method, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.startsWith("multipart/form-data")) {
      // A STEP upload. The boundary lives IN the content-type header, so it must be passed
      // through verbatim rather than rebuilt - and the body must stay bytes, because
      // req.text() would corrupt it. Hard-coding application/json here is what made the
      // front door impossible: every job had to be ingested for the user by an agent.
      init.headers = { "Content-Type": contentType };
      init.body = Buffer.from(await req.arrayBuffer());
    } else {
      init.headers = { "Content-Type": "application/json" };
      init.body = await req.text();
    }
  }
  try {
    const res = await fetch(url, init);
    const body = await res.arrayBuffer();
    const headers: Record<string, string> = {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
    };
    // Carry the download filename through. Without it the browser saves every cut file as
    // the route name - "nc1" - and a folder of identically-named downloads is useless to
    // whoever takes them to a machine.
    const cd = res.headers.get("content-disposition");
    if (cd) headers["Content-Disposition"] = cd;
    return new NextResponse(body, { status: res.status, headers });
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
