import { NextRequest, NextResponse } from "next/server";
import {
  buildCuttingListHtml,
  type CuttingListData,
} from "@/lib/pdf/cutting-list-print-html";

export const dynamic = "force-dynamic";

const NESTING_SERVICE_URL =
  process.env.NESTING_SERVICE_URL ?? "http://10.0.0.74:8001";

// Print-formatted cutting list as HTML, shown directly in the browser (epic
// platform-portal-6gr.3). This is the same self-contained HTML that gets filed
// as a numbered PDF at issue time (via the doc-service); here it is served as-is
// for viewing/printing — no PDF round-trip.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  try {
    const res = await fetch(
      `${NESTING_SERVICE_URL}/api/v1/nesting/cutting-list/${taskId}`
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: "Cutting list not available" },
        { status: res.status }
      );
    }
    const cuttingList = (await res.json()) as CuttingListData;
    const { html } = buildCuttingListHtml(cuttingList);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Failed to build cutting-list HTML:", err);
    return NextResponse.json(
      { error: "Failed to reach nesting service" },
      { status: 502 }
    );
  }
}
