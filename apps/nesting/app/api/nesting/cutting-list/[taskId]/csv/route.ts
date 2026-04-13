import { NextRequest, NextResponse } from "next/server";

const NESTING_SERVICE_URL =
  process.env.NESTING_SERVICE_URL ?? "http://10.0.0.74:8001";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  try {
    const res = await fetch(
      `${NESTING_SERVICE_URL}/api/v1/nesting/cutting-list/${taskId}/csv`
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "CSV not available" },
        { status: res.status }
      );
    }

    const csv = await res.text();
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": res.headers.get("Content-Disposition") ??
          `attachment; filename="cutting_list_${taskId}.csv"`,
      },
    });
  } catch (err) {
    console.error("Failed to proxy CSV:", err);
    return NextResponse.json(
      { error: "Failed to reach nesting service" },
      { status: 502 }
    );
  }
}
