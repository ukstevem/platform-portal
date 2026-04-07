import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const LASER_QUOTE_SERVICE_URL = process.env.LASER_QUOTE_SERVICE_URL ?? "http://localhost:8090";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

// Only allow these path prefixes through the proxy
const ALLOWED_PREFIXES = ["quotes/"];

function isAllowedPath(segments: string[]): boolean {
  const joined = segments.join("/");
  return ALLOWED_PREFIXES.some((prefix) => joined.startsWith(prefix));
}

function hasPathTraversal(segments: string[]): boolean {
  return segments.some((s) => s === ".." || s === "." || s.includes("\\"));
}

async function verifyAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("cookie") ?? "";
  // Extract the Supabase access token from cookies
  const match = authHeader.match(/sb-[^=]+-auth-token[^=]*=([^;]+)/);
  if (!match) return false;
  try {
    const tokenData = JSON.parse(decodeURIComponent(match[1]));
    const accessToken = Array.isArray(tokenData) ? tokenData[0] : tokenData?.access_token;
    if (!accessToken) return false;
    const { data } = await supabaseAdmin.auth.getUser(accessToken);
    return !!data?.user;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  if (hasPathTraversal(path) || !isAllowedPath(path)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await verifyAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  if (!(await verifyAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
