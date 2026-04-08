import { NextRequest, NextResponse } from "next/server";

const DOC_SERVICE_URL = process.env.DOC_SERVICE_URL ?? "http://10.0.0.74:3000";

/**
 * Proxy route for serving STL files via the document service.
 *
 * URL pattern: /assembly/api/stl/{runId}/{filename}.stl
 * Proxies to: DOC_SERVICE_URL/files/stl_models/{runId}/{filename}.stl
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path;
  if (!segments || segments.length < 2) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Validate segments to prevent path traversal
  for (const seg of segments) {
    if (seg.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
  }

  // Build the document service URL, encoding each segment for spaces etc.
  const encodedPath = segments.map((s) => encodeURIComponent(s)).join("/");
  const url = `${DOC_SERVICE_URL}/files/stl_models/${encodedPath}`;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      return NextResponse.json(
        { error: "STL not found" },
        { status: res.status }
      );
    }

    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("Failed to fetch STL from document service:", url, err);
    return NextResponse.json(
      { error: "Failed to fetch STL" },
      { status: 502 }
    );
  }
}
