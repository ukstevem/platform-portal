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

/**
 * Retry a CONNECTION failure, not an HTTP status.
 *
 * The 3D view fetches one mesh per prototype, several at a time, and under that
 * concurrency the hop to the CAD service intermittently drops the connection — measured at
 * 3 failures in 24 requests, six in flight. Each one became a 502 and a piece of steel
 * silently missing from the structure, which is the one thing this viewer must never do.
 *
 * A non-2xx response is a real answer and is passed straight back: a 404 or a 422 means
 * something, and retrying it would just delay the message.
 */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      // A body can only be consumed once, so a request that carries one cannot be replayed.
      if (init.body != null) break;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw lastErr;
}

async function forward(req: NextRequest, path: string[]) {
  const search = req.nextUrl.search ?? "";
  const url = `${CAD_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  // Carry the client's validator UPSTREAM. Without it the browser's If-None-Match never
  // reaches the CAD service, so it can never answer 304 and the viewer either re-downloads a
  // 4 MB mesh every load or — worse, with force-cache — never asks at all and draws geometry
  // from before the model changed.
  const reqHeaders: Record<string, string> = { "Content-Type": "application/json" };
  const inm = req.headers.get("if-none-match");
  if (inm) reqHeaders["If-None-Match"] = inm;
  const init: RequestInit = {
    method: req.method,
    headers: reqHeaders,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  try {
    const res = await fetchWithRetry(url, init);
    const headers: Record<string, string> = {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
    };
    // Carry the download filename through, or every export saves as the route name and a
    // folder of files called "sequence.pdf" is useless to whoever takes them to site.
    const cd = res.headers.get("content-disposition");
    if (cd) headers["Content-Disposition"] = cd;
    // ...and the cache VALIDATORS back down. A proxy that drops these turns a revalidating
    // fetch into an unconditional one, and leaves the browser free to keep serving a mesh
    // from before the geometry changed.
    for (const h of ["etag", "cache-control", "last-modified"]) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    // 304 carries no body, and constructing a response with one is a runtime error.
    if (res.status === 304) return new NextResponse(null, { status: 304, headers });
    const body = await res.arrayBuffer();
    // COMPRESS. A mesh is JSON numbers and compresses about 6x; undici transparently decodes
    // the upstream gzip, so without re-compressing here the browser is handed the full ~60 MB
    // of a whole-model view over the wire. Only worth it above a threshold — a small JSON reply
    // costs more in CPU than it saves in bytes.
    const wantsGzip = (req.headers.get("accept-encoding") ?? "").includes("gzip");
    if (wantsGzip && body.byteLength > 1_000_000 && !headers["content-encoding"]) {
      const { gzipSync } = await import("node:zlib");
      const packed = gzipSync(Buffer.from(body), { level: 6 });
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      return new NextResponse(packed, { status: res.status, headers });
    }
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
