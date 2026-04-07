import { NextRequest, NextResponse } from "next/server";

const LASER_QUOTE_SERVICE_URL = process.env.LASER_QUOTE_SERVICE_URL ?? "http://localhost:8090";

// Only allow these path prefixes through the proxy
const ALLOWED_PREFIXES = ["quotes", "import"];

function isAllowedPath(segments: string[]): boolean {
  const joined = segments.join("/");
  return ALLOWED_PREFIXES.some((prefix) => joined === prefix || joined.startsWith(prefix + "/"));
}

function hasPathTraversal(segments: string[]): boolean {
  return segments.some((s) => s === ".." || s === "." || s.includes("\\"));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  if (hasPathTraversal(path) || !isAllowedPath(path)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // GET requests (PDF/delivery note downloads) rely on page-level auth.
  // The links are only visible to authenticated users and the paths are allowlisted.

  const servicePath = `/api/laser/${path.join("/")}`;
  const url = `${LASER_QUOTE_SERVICE_URL}${servicePath}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json({ error: "Service error" }, { status: res.status });
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "content-type": contentType,
        "content-disposition": res.headers.get("content-disposition") ?? "",
      },
    });
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  if (hasPathTraversal(path) || !isAllowedPath(path)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // POST requests (refresh, requote) rely on page-level auth.
  // The actions are only triggered by authenticated users and paths are allowlisted.

  const servicePath = `/api/laser/${path.join("/")}`;
  const url = `${LASER_QUOTE_SERVICE_URL}${servicePath}`;

  try {
    const contentType = req.headers.get("content-type") ?? "application/json";
    const body = contentType.includes("json") ? await req.text() : await req.arrayBuffer();
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 502 });
  }
}
