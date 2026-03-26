import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const DOC_SERVICE_URL = process.env.DOC_SERVICE_URL ?? "http://localhost:8080";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const allowed = ["pdf", "png", "jpg", "jpeg", "tiff", "tif"];
  if (!allowed.includes(ext)) {
    return NextResponse.json({ error: `Unsupported file type: .${ext}` }, { status: 400 });
  }

  const id = randomUUID();
  const storedName = `${id}.${ext}`;

  // Upload file to document service
  try {
    const uploadForm = new FormData();
    uploadForm.append("file", file, storedName);

    const res = await fetch(`${DOC_SERVICE_URL}/api/scan/upload`, {
      method: "POST",
      body: uploadForm,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[upload] Document service error: ${res.status} ${text}`);
      return NextResponse.json({ error: "Failed to upload file to document service" }, { status: 502 });
    }

    console.log(`[upload] Sent ${file.name} to document service as ${storedName}`);
  } catch (err) {
    console.error("[upload] Failed to reach document service:", err);
    return NextResponse.json({ error: `Document service unavailable: ${err}` }, { status: 502 });
  }

  // Create scan job in Supabase
  const { error: dbError } = await supabaseAdmin.from("document_incoming_scan").insert({
    id,
    file_name: file.name,
    file_path: storedName,
    status: "queued",
  });

  if (dbError) {
    console.error("Failed to create scan job:", dbError);
    return NextResponse.json({ error: "Failed to create scan job" }, { status: 500 });
  }

  return NextResponse.json({ id, fileName: file.name });
}
