import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const INBOX_DIR = process.env.SCANNER_INBOX_DIR ?? "/data/scanner/inbox";

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

  try {
    await mkdir(INBOX_DIR, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(join(INBOX_DIR, storedName), bytes);
  } catch (err) {
    console.error("Failed to save file:", err);
    return NextResponse.json({ error: "Failed to save file" }, { status: 500 });
  }

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
