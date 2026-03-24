import { createClient } from "@supabase/supabase-js";
import { processJob } from "./processor.js";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "5000");

const supabase = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
);

async function pollOnce() {
  // Grab the oldest queued job
  const { data: jobs, error } = await supabase
    .from("document_incoming_scan")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[worker] Failed to poll document_incoming_scan:", error.message);
    return;
  }

  if (!jobs?.length) return;

  const job = jobs[0];
  console.log(`[worker] Processing job ${job.id} — ${job.file_name}`);

  // Mark as scanning
  await supabase.from("document_incoming_scan").update({ status: "scanning", updated_at: new Date().toISOString() }).eq("id", job.id);

  try {
    const result = await processJob(job, supabase);

    await supabase.from("document_incoming_scan").update({
      status: "filed",
      type_code: result.typeCode,
      asset_code: result.assetCode,
      doc_code: result.docCode,
      period: result.period,
      document_type: result.documentType,
      destination: result.destination,
      filed_path: result.filedPath,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);

    console.log(`[worker] Job ${job.id} filed → ${result.filedPath}`);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`[worker] Job ${job.id} failed:`, message);

    await supabase.from("document_incoming_scan").update({
      status: "error",
      error_message: message,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
  }
}

async function main() {
  console.log("[worker] Scanner worker starting...");
  console.log(`[worker] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[worker] Inbox: ${process.env.SCANNER_INBOX_DIR ?? "/data/scanner/inbox"}`);
  console.log(`[worker] Filed: ${process.env.SCANNER_FILED_DIR ?? "/data/scanner/filed"}`);

  // Poll loop
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      console.error("[worker] Unexpected error in poll loop:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
