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
      `${NESTING_SERVICE_URL}/api/v1/nesting/cutting-list/${taskId}`
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("Failed to proxy cutting list:", err);
    return NextResponse.json(
      { error: "Failed to reach nesting service" },
      { status: 502 }
    );
  }
}
