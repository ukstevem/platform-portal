import { NextRequest, NextResponse } from "next/server";

const NESTING_SERVICE_URL =
  process.env.NESTING_SERVICE_URL ?? "http://10.0.0.74:8001";
const DOC_SERVICE_URL =
  process.env.DOC_SERVICE_URL ?? "http://10.0.0.74:3000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  /* 1. Fetch the full result from the nesting service (includes run_at, sections, totals) */
  let result: Record<string, unknown>;
  try {
    const res = await fetch(
      `${NESTING_SERVICE_URL}/api/v1/nesting/result/${taskId}`
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: "Result not available" },
        { status: res.status }
      );
    }
    result = await res.json();
  } catch (err) {
    console.error("Failed to fetch nesting result:", err);
    return NextResponse.json(
      { error: "Failed to reach nesting service" },
      { status: 502 }
    );
  }

  /* 2. Fetch the formatted cutting list (has bar_label, cut_no, etc.) */
  let cuttingList: Record<string, unknown>;
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
    cuttingList = await res.json();
  } catch (err) {
    console.error("Failed to fetch cutting list:", err);
    return NextResponse.json(
      { error: "Failed to reach nesting service" },
      { status: 502 }
    );
  }

  /* 3. Merge run_at from the raw result into the cutting list payload */
  const pdfPayload = {
    ...cuttingList,
    run_at: result.run_at ?? undefined,
  };

  /* 4. POST to doc service cutting-list template */
  try {
    const pdfRes = await fetch(
      `${DOC_SERVICE_URL}/api/nesting/cutting-list/pdf`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pdfPayload),
      }
    );

    if (!pdfRes.ok) {
      const text = await pdfRes.text();
      console.error("Doc service PDF error:", pdfRes.status, text);
      return NextResponse.json(
        { error: "PDF generation failed", detail: text },
        { status: pdfRes.status }
      );
    }

    const pdfBuffer = await pdfRes.arrayBuffer();
    const label = (cuttingList as { job_label?: string }).job_label || taskId;
    const filename = `cutting_list_${label}.pdf`.replace(
      /[^a-zA-Z0-9_\-.]/g,
      "_"
    );

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Failed to reach doc service for PDF:", err);
    return NextResponse.json(
      { error: "Document service unavailable" },
      { status: 502 }
    );
  }
}
