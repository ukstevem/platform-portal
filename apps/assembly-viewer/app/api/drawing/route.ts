import { NextRequest, NextResponse } from "next/server";

const DOC_SERVICE_URL = process.env.DOC_SERVICE_URL ?? "http://10.0.0.74:3000";
const DRAWING_SERVICE_URL = process.env.DRAWING_SERVICE_URL ?? "http://10.0.0.74:8002";

/**
 * Proxy route for generating engineering drawings via the drawing service.
 *
 * Accepts the part details from the frontend, constructs the full STL URL
 * from the document service path, and forwards to the drawing service.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { run_id, node_id, part_name, assembly_name, project_name, stl_path, placement } = body;

  if (!run_id || !node_id || !part_name || !stl_path) {
    return NextResponse.json(
      { error: "Missing required fields: run_id, node_id, part_name, stl_path" },
      { status: 400 }
    );
  }

  // Convert internal stl_path (/outputs/stl/...) to full document service URL
  const stl_url = `${DOC_SERVICE_URL}${(stl_path as string).replace(/^\/outputs\/stl\//, "/files/stl_models/")}`;

  const payload: Record<string, unknown> = {
    run_id,
    node_id,
    part_name,
    assembly_name: assembly_name || "",
    project_name: project_name || "",
    stl_url,
  };
  if (placement) payload.placement = placement;

  try {
    const res = await fetch(`${DRAWING_SERVICE_URL}/api/v1/drawings/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Drawing service error:", res.status, text);
      return NextResponse.json(
        { error: "Drawing service error", detail: text },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Failed to reach drawing service:", err);
    return NextResponse.json(
      { error: "Drawing service unavailable" },
      { status: 502 }
    );
  }
}
