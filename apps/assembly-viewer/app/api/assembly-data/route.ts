import { NextResponse } from "next/server";

const DOC_SERVICE_URL = process.env.DOC_SERVICE_URL ?? "http://10.0.0.74:3000";

/**
 * Serves the assembly tree + STL map data.
 *
 * Fetches from document service: /files/stl_models/{runId}/assembly.json
 * Currently hardcoded to run aa1964c8.
 */
export async function GET() {
  const runId = "aa1964c8";
  const url = `${DOC_SERVICE_URL}/files/stl_models/${runId}/assembly.json`;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.error("Document service returned", res.status, "for", url);
      return NextResponse.json(
        { error: "Failed to load assembly data" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Failed to fetch assembly data from document service:", url, err);
    return NextResponse.json(
      { error: "Failed to load assembly data" },
      { status: 502 }
    );
  }
}
