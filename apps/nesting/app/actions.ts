"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  buildCuttingListHtml,
  type CuttingListData,
} from "@/lib/pdf/cutting-list-print-html";
import { fileCuttingListDocument } from "@/lib/pdf/file-client";

const NESTING_SERVICE_URL =
  process.env.NESTING_SERVICE_URL ?? "http://10.0.0.74:8001";

export interface FileCuttingListActionResult {
  ok: boolean;
  docNumber?: string;
  url?: string;
  alreadyFiled?: boolean;
  error?: string;
}

/**
 * File the cutting list for a nesting task as a numbered, tracked PDF
 * (epic platform-portal-6gr.4). Builds the same self-contained HTML used for
 * the Print View, renders + files it via the doc-service, and stamps the
 * returned doc number onto the nesting_jobs row.
 *
 * Guards against re-filing: if the job already has issued_doc_id, returns it
 * without minting a new number (the doc-service byte-dedup never fires for
 * rendered output — Chromium embeds timestamps — so the guard lives here).
 */
export async function fileCuttingList(
  taskId: string
): Promise<FileCuttingListActionResult> {
  const sb = getSupabaseAdmin();

  const { data: job, error: jobErr } = await sb
    .from("nesting_jobs")
    .select("id, project_number, issued_doc_id, issued_doc_number")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobErr) return { ok: false, error: jobErr.message };
  if (!job) return { ok: false, error: "Nesting job not found for this task." };
  if (job.issued_doc_id) {
    return { ok: true, alreadyFiled: true, docNumber: job.issued_doc_number ?? undefined };
  }
  if (!job.project_number || !String(job.project_number).trim()) {
    return {
      ok: false,
      error: "This nest has no project number; a project number is required to file a cutting list.",
    };
  }

  const res = await fetch(
    `${NESTING_SERVICE_URL}/api/v1/nesting/cutting-list/${taskId}`
  );
  if (!res.ok) {
    return { ok: false, error: `Cutting list not available (${res.status}).` };
  }
  const cuttingList = (await res.json()) as CuttingListData;

  const { html, footerLeft, fileName } = buildCuttingListHtml(cuttingList);

  let filed;
  try {
    filed = await fileCuttingListDocument({
      html,
      footerLeft,
      projectNumber: String(job.project_number),
      originalFileName: fileName,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const { error: upErr } = await sb
    .from("nesting_jobs")
    .update({ issued_doc_id: filed.id, issued_doc_number: filed.doc_number })
    .eq("id", job.id);

  if (upErr) {
    // Filed but not stamped — surface loudly with the doc number so it can be
    // reconciled by hand (a retry would re-file).
    return {
      ok: false,
      error: `Filed as ${filed.doc_number} but recording it on the job failed: ${upErr.message}. Reconcile manually.`,
    };
  }

  return { ok: true, docNumber: filed.doc_number, url: filed.url };
}
