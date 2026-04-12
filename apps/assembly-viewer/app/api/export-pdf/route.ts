import { NextRequest, NextResponse } from "next/server";

const DOC_SERVICE_URL = process.env.DOC_SERVICE_URL ?? "http://10.0.0.74:3000";

/**
 * Proxy route for generating a part-status PDF report via the document service.
 *
 * Accepts table data from the frontend, forwards to the document service's
 * generic PDF report endpoint which uses the shared PSS branded renderer.
 */
export async function POST(request: NextRequest) {
  let body: {
    projectName?: string;
    assemblyName?: string;
    rows?: { name: string; type: string; status: string; updated: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { projectName = "", assemblyName = "", rows = [] } = body;
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows" }, { status: 400 });
  }

  // Map to the document service's generic report format
  const reportPayload = {
    title: projectName || "Part Status Report",
    subtitle: assemblyName || undefined,
    orientation: "landscape",
    columns: [
      { header: "Name", width: 300, align: "left" },
      { header: "Type", width: 120, align: "left" },
      { header: "Status", width: 120, align: "left" },
      { header: "Updated", width: 160, align: "left" },
    ],
    rows: rows.map((r) => [r.name, r.type, r.status || "--", r.updated || ""]),
  };

  try {
    const res = await fetch(`${DOC_SERVICE_URL}/api/pdf/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportPayload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Document service PDF error:", res.status, text);
      return NextResponse.json(
        { error: "PDF generation failed", detail: text },
        { status: res.status }
      );
    }

    const pdfBuffer = await res.arrayBuffer();
    const contentDisposition = res.headers.get("Content-Disposition") || "";

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition
          || `attachment; filename="${(projectName || "status").replace(/[^a-zA-Z0-9_\-.]/g, "_")}.pdf"`,
      },
    });
  } catch (err) {
    console.error("Failed to reach document service for PDF:", err);
    return NextResponse.json(
      { error: "Document service unavailable" },
      { status: 502 }
    );
  }
}
