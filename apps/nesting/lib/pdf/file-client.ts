// Files the cutting-list HTML as a numbered, tracked PDF via
// pss-document-service /api/file-html (mint-before-render). Mirrors the proven
// pss-purchase-order client. Server-only (uses the non-public DOC key).
// Epic platform-portal-6gr.4.

export interface FileCuttingListResult {
  id: string;
  doc_number: string;
  url: string;
  file_name: string;
}

export interface FileCuttingListOptions {
  html: string;
  footerLeft: string;
  projectNumber: string;
  originalFileName: string;
}

export async function fileCuttingListDocument(
  opts: FileCuttingListOptions
): Promise<FileCuttingListResult> {
  const url = process.env.DOC_SERVICE_URL;
  const key = process.env.NESTING_DOC_SERVICE_API_KEY;
  if (!url || !key) {
    throw new Error("DOC_SERVICE_URL / NESTING_DOC_SERVICE_API_KEY not configured");
  }
  const isoDescriptionId = Number(process.env.NESTING_ISO_DESCRIPTION_ID ?? 66);

  const res = await fetch(`${url.replace(/\/$/, "")}/api/file-html`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify({
      html: opts.html,
      footer: { left: opts.footerLeft },
      // Cutting list is landscape (the builder's layout assumes it).
      page: { format: "A4", orientation: "landscape" },
      iso_description_id: isoDescriptionId,
      // Doc-service requires a 5-digit reference: '0005' files as '00005'.
      project_number: opts.projectNumber.padStart(5, "0"),
      original_file_name: opts.originalFileName,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const body = (await res.json().catch(() => null)) as
    | (FileCuttingListResult & { status?: string; error_code?: string; error_message?: string })
    | null;

  if (!res.ok || !body || body.status === "error") {
    throw new Error(
      `doc-service file-html failed (${res.status}): ${body?.error_code ?? ""} ${body?.error_message ?? ""}`.trim()
    );
  }
  return body;
}
