import { readFile, mkdir, copyFile } from "fs/promises";
import { join, extname } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";
import jsQR from "jsqr";
import type { SupabaseClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

const INBOX_DIR = process.env.SCANNER_INBOX_DIR ?? "/data/scanner/inbox";
const FILED_DIR = process.env.SCANNER_FILED_DIR ?? "/data/scanner/filed";

type ParsedQR = {
  typeCode: string;
  assetCode: string | null;
  docCode: string | null;
  revision: string | null;
};

type ProcessResult = {
  typeCode: string;
  assetCode: string | null;
  docCode: string | null;
  period: string;
  documentType: string;
  docName: string | null;
  destination: string;
  filedPath: string;
};

/**
 * Parse pipe-delimited QR content.
 * Format: {type_code}|{asset_code}|{doc_code}|{revision}
 *
 * Examples:
 *   HS|CRANE-01|WEEKLY-PREUSE
 *   HS|CRANE-01|LOLER-ANNUAL
 *   X-IC|CRANE-01|BRAKE-TEST
 *   DR|24-1087||C                 (no doc_code, revision C)
 */
function parseQR(raw: string): ParsedQR {
  const parts = raw.split("|").map((s) => s.trim());
  return {
    typeCode: parts[0],
    assetCode: parts[1] || null,
    docCode: parts[2] || null,
    revision: parts[3] || null,
  };
}

/**
 * Derive the current ISO 8601 week period (e.g. "2026-W13").
 */
function currentWeekPeriod(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Build ISO 19650 compliant filename.
 *
 * Format: {identifier}-{type_code}-{doc_code}-{period}[-{revision}].{ext}
 *
 * Examples:
 *   CRANE-01-HS-WEEKLY-PREUSE-2026-W13.pdf
 *   CRANE-01-HS-LOLER-ANNUAL-2026-W13.pdf
 *   24-1087-X-IC-BRAKE-TEST-2026-W13-001.pdf
 */
function buildIsoFilename(
  identifier: string,
  typeCode: string,
  docCode: string | null,
  period: string,
  revision: string | null,
  originalExt: string
): string {
  const parts = [identifier, typeCode];
  if (docCode) parts.push(docCode);
  parts.push(period);
  if (revision) parts.push(revision);
  return `${parts.join("_")}${originalExt}`;
}

/**
 * Convert a PDF's first page to a PNG buffer using poppler's pdftoppm.
 * Falls back if the file is already an image.
 */
async function getFirstPageImage(filePath: string): Promise<Buffer> {
  const ext = extname(filePath).toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".tiff", ".tif"].includes(ext)) {
    return readFile(filePath);
  }

  const tmpPrefix = filePath.replace(/\.pdf$/i, "-page");
  await execFileAsync("pdftoppm", [
    "-png",
    "-f", "1",
    "-l", "1",
    "-singlefile",
    "-r", "300",
    filePath,
    tmpPrefix,
  ]);

  return readFile(`${tmpPrefix}.png`);
}

/**
 * Decode a QR code from an image buffer using jsQR.
 */
async function readQR(imageBuffer: Buffer): Promise<string | null> {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return code?.data ?? null;
}

/**
 * Look up the filing rule by ISO 19650 type code.
 */
async function getFilingRule(supabase: SupabaseClient, typeCode: string) {
  const { data, error } = await supabase
    .from("document_filing_rule")
    .select("document_type, destination")
    .eq("type_code", typeCode)
    .eq("active", true)
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as { document_type: string; destination: string };
}

/**
 * Validate asset code exists in asset_register.
 */
async function validateAsset(supabase: SupabaseClient, assetCode: string) {
  const { data, error } = await supabase
    .from("asset_register")
    .select("asset_code, asset_name")
    .eq("asset_code", assetCode)
    .eq("active", true)
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as { asset_code: string; asset_name: string };
}

/**
 * Validate doc_code exists in document_definition and matches the type_code.
 */
async function validateDocCode(supabase: SupabaseClient, docCode: string, typeCode: string) {
  const { data, error } = await supabase
    .from("document_definition")
    .select("doc_code, doc_name, type_code")
    .eq("doc_code", docCode)
    .eq("active", true)
    .limit(1)
    .single();

  if (error || !data) return null;

  if (data.type_code !== typeCode) {
    return { mismatch: true, doc_name: data.doc_name, expected_type: data.type_code } as const;
  }

  return data as { doc_code: string; doc_name: string; type_code: string };
}

/**
 * Process a single scan job:
 *   read QR → parse type|asset|doc_code|revision → validate → file document.
 *
 * Folder structure (ISO 19650):
 *   {identifier}/{type_code}/{iso_filename}
 *
 * Examples:
 *   CRANE-01/HS/CRANE-01-HS-WEEKLY-PREUSE-2026-W13.pdf
 *   CRANE-01/X-IC/CRANE-01-X-IC-BRAKE-TEST-2026-W13.pdf
 *   24-1087/DR/24-1087-DR-2026-W13-C.pdf
 */
export async function processJob(
  job: { id: string; file_name: string; file_path: string },
  supabase: SupabaseClient
): Promise<ProcessResult> {
  const inboxPath = join(INBOX_DIR, job.file_path);
  const originalExt = extname(job.file_name).toLowerCase() || ".pdf";

  // 1. Extract first page as image
  const imageBuffer = await getFirstPageImage(inboxPath);

  // 2. Read and parse QR code
  const rawQR = await readQR(imageBuffer);
  if (!rawQR) {
    throw new Error("No QR code found on first page");
  }

  const qr = parseQR(rawQR);

  // 3. Look up filing rule
  const rule = await getFilingRule(supabase, qr.typeCode);
  if (!rule) {
    throw new Error(`No filing rule for type code: "${qr.typeCode}"`);
  }

  // 4. Validate asset if provided
  if (qr.assetCode) {
    const asset = await validateAsset(supabase, qr.assetCode);
    if (!asset) {
      throw new Error(`Unknown asset: "${qr.assetCode}" — not found in asset register`);
    }
  }

  // 5. Validate doc_code if provided
  let docName: string | null = null;
  if (qr.docCode) {
    const docDef = await validateDocCode(supabase, qr.docCode, qr.typeCode);
    if (!docDef) {
      throw new Error(`Unknown document code: "${qr.docCode}" — not found in document definitions`);
    }
    if ("mismatch" in docDef) {
      throw new Error(`Document "${qr.docCode}" belongs to type "${docDef.expected_type}", not "${qr.typeCode}"`);
    }
    docName = docDef.doc_name;
  }

  // 6. Determine period — auto-derive current week
  const period = currentWeekPeriod();

  // 7. Determine identifier (asset code, or type code if no asset)
  const identifier = qr.assetCode ?? qr.typeCode;

  // 8. Build ISO 19650 filename
  const isoFilename = buildIsoFilename(identifier, qr.typeCode, qr.docCode, period, qr.revision, originalExt);

  // 9. Build folder path: {identifier}/{type_code}/{doc_code}/
  //    e.g. CRANE-01/HS/WEEKLY-PREUSE/
  const pathParts = [identifier, qr.typeCode];
  if (qr.docCode) pathParts.push(qr.docCode);

  const destDir = join(FILED_DIR, ...pathParts);
  await mkdir(destDir, { recursive: true });

  const filedPath = join(...pathParts, isoFilename);
  await copyFile(inboxPath, join(FILED_DIR, filedPath));

  return {
    typeCode: qr.typeCode,
    assetCode: qr.assetCode,
    docCode: qr.docCode,
    period,
    documentType: rule.document_type,
    docName,
    destination: join(...pathParts),
    filedPath,
  };
}
