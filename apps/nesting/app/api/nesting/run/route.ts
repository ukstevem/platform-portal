import { NextRequest, NextResponse } from "next/server";

const NESTING_SERVICE_URL =
  process.env.NESTING_SERVICE_URL ?? "http://10.0.0.74:8001";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${NESTING_SERVICE_URL}/api/v1/nesting/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("Failed to proxy nesting run:", err);
    return NextResponse.json(
      { error: "Failed to reach nesting service" },
      { status: 502 }
    );
  }
}
