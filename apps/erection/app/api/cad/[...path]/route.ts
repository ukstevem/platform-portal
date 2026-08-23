import { NextRequest, NextResponse } from "next/server";

/**
 * Thin proxy to the cad-automation service (stage3).
 *
 * The browser never calls the service directly: it is not on the platform network from a
 * user's machine, and routing through here keeps the service URL a deployment concern
 * rather than something baked into client bundles. Same shape as cad-review's proxy.
 *
 * Unlike cad-review's, this one forwards PUT and DELETE as well — the planner edits and
 * reorders steps, and a proxy that quietly supported only GET/POST would fail those with
 * a 405 that looks like a backend fault rather than a missing handler here.
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
    const body = await res.arrayBuffer();
    const headers: Record<string, string> = {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
    };
    // Carry the download filename through, or every export saves as the route name and a
    // folder of files called "sequence.pdf" is useless to whoever takes them to site.
    const cd = res.headers.get("content-disposition");
    if (cd) headers["Content-Disposition"] = cd;
    return new NextResponse(body, { status: res.status, headers });
  } catch (err) {
    console.error("erection proxy failed:", url, err);
    return NextResponse.json(
      { error: "Could not reach the CAD service", url },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
