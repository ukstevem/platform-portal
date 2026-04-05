import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const LASER_QUOTE_SERVICE_URL = process.env.LASER_QUOTE_SERVICE_URL ?? "http://localhost:8090";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const customer = form.get("customer") as string;
  const material = form.get("material") as string;
  const grade = form.get("grade") as string;
  const sheetPrice = form.get("sheetPrice") as string;
  const materialRate = form.get("materialRate") as string;
  const incoterms = form.get("incoterms") as string;
  const leadTime = form.get("leadTime") as string;
  const premium = form.get("premium") === "true";
  const remCharge = form.get("remCharge") === "true";

  if (!customer || !material || !grade) {
    return NextResponse.json({ error: "Customer, material, and grade are required" }, { status: 400 });
  }

  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["csv", "nc"].includes(ext)) {
      return NextResponse.json({ error: `Unsupported file type: .${ext}` }, { status: 400 });
    }
  }

  const id = randomUUID();

  // Create import record
  const { error: dbError } = await supabaseAdmin.from("laser_import").insert({
    id,
    status: "queued",
    file_count: files.length,
    customer: customer.toUpperCase(),
    material,
    grade: grade.toUpperCase(),
    sheet_price: sheetPrice ? parseFloat(sheetPrice) : null,
    material_rate: materialRate ? parseFloat(materialRate) : null,
    premium,
    rem_charge: remCharge,
  });

  if (dbError) {
    console.error("Failed to create import job:", dbError);
    return NextResponse.json({ error: "Failed to create import job" }, { status: 500 });
  }

  // Forward files to laserquote service
  try {
    const uploadForm = new FormData();
    uploadForm.append("importId", id);
    uploadForm.append("incoterms", incoterms || "EXW");
    uploadForm.append("leadTime", leadTime || "");
    for (const file of files) {
      uploadForm.append("files", file, file.name);
    }

    const res = await fetch(`${LASER_QUOTE_SERVICE_URL}/api/laser/import`, {
      method: "POST",
      body: uploadForm,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[upload] LaserQuote service error: ${res.status} ${text}`);
      // Mark import as error
      await supabaseAdmin
        .from("laser_import")
        .update({ status: "error", error_message: "Service unavailable" })
        .eq("id", id);
      return NextResponse.json({ error: "Failed to send files to processing service" }, { status: 502 });
    }

    console.log(`[upload] Sent ${files.length} file(s) to LaserQuote service for import ${id}`);
  } catch (err) {
    console.error("[upload] Failed to reach LaserQuote service:", err);
    // Mark as error but don't fail the whole request - service may pick up later
    await supabaseAdmin
      .from("laser_import")
      .update({ status: "error", error_message: `Service unavailable: ${err}` })
      .eq("id", id);
    return NextResponse.json({ error: `LaserQuote service unavailable` }, { status: 502 });
  }

  return NextResponse.json({ id, fileCount: files.length });
}
