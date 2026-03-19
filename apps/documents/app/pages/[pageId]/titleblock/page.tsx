import { createClient, SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import TitleblockAnnotator from "./TitleblockAnnotator";

type PageProps = {
  params: Promise<{ pageId: string }>;
};

type FieldKey = "drawing_number" | "drawing_title" | "revision" | "other";

interface NormalisedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FieldArea {
  field: FieldKey;
  x_rel: number;
  y_rel: number;
  width_rel: number;
  height_rel: number;
}

interface PageRow {
  id: string;
  document_id: string;
  page_number: number;
  image_object_path: string | null;
  status: string | null;
  titleblock_x: number | null;
  titleblock_y: number | null;
  titleblock_width: number | null;
  titleblock_height: number | null;
  titleblock_fingerprint: unknown | null;
}

function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing for titleblock page");
  return createClient(url, key, { auth: { persistSession: false } });
}

function getGatewayBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_DOC_GATEWAY_BASE_URL;
  if (!raw) throw new Error("NEXT_PUBLIC_DOC_GATEWAY_BASE_URL is not set.");
  return raw.trim().replace(/\/+$/, "");
}

function parseFingerprint(value: unknown): FieldArea[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as { version?: unknown; areas?: unknown[]; clicks?: unknown[] };
  const validFields: FieldKey[] = ["drawing_number", "drawing_title", "revision", "other"];
  const result: FieldArea[] = [];

  if (Array.isArray(obj.areas)) {
    for (const item of obj.areas) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.field !== "string" || !validFields.includes(rec.field as FieldKey)) continue;
      const x = Number(rec.x_rel), y = Number(rec.y_rel), w = Number(rec.width_rel), h = Number(rec.height_rel);
      if ([x, y, w, h].some(Number.isNaN)) continue;
      result.push({ field: rec.field as FieldKey, x_rel: x, y_rel: y, width_rel: w, height_rel: h });
    }
    return result;
  }

  if ((typeof obj.version !== "number" || obj.version === 1) && Array.isArray(obj.clicks)) {
    for (const item of obj.clicks) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.field !== "string" || !validFields.includes(rec.field as FieldKey)) continue;
      const cx = Math.min(Math.max(Number(rec.x_rel ?? rec.x), 0), 1);
      const cy = Math.min(Math.max(Number(rec.y_rel ?? rec.y), 0), 1);
      if (Number.isNaN(cx) || Number.isNaN(cy)) continue;
      const left = Math.max(cx - 0.075, 0), top = Math.max(cy - 0.075, 0);
      const w = Math.min(0.15, 1 - left), h = Math.min(0.15, 1 - top);
      if (w <= 0 || h <= 0) continue;
      result.push({ field: rec.field as FieldKey, x_rel: left, y_rel: top, width_rel: w, height_rel: h });
    }
  }

  return result;
}

function toInitialNormalisedRect(row: PageRow): NormalisedRect | null {
  const { titleblock_x: x, titleblock_y: y, titleblock_width: w, titleblock_height: h } = row;
  if (x === null || y === null || w === null || h === null) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) return null;
  return { left: x, top: y, width: w, height: h };
}

// Error state component
function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="p-6 max-w-2xl">
      <Link href="/" className="rounded border px-3 py-1 text-sm hover:bg-gray-100 inline-block mb-4">
        &larr; Dashboard
      </Link>
      <div className="border rounded bg-white p-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </div>
  );
}

export default async function TitleblockPage(props: PageProps) {
  const { pageId } = await props.params;

  if (!pageId) {
    return <ErrorCard title="Invalid parameters" message="The page id is missing from the route." />;
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseServerClient();
  } catch (err) {
    return <ErrorCard title="Configuration error" message={err instanceof Error ? err.message : "Supabase not configured"} />;
  }

  const { data, error } = await supabase
    .from("document_pages")
    .select("id,document_id,page_number,image_object_path,status,titleblock_x,titleblock_y,titleblock_width,titleblock_height,titleblock_fingerprint")
    .eq("id", pageId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching document_pages row:", error);
    return <ErrorCard title="Database error" message={`Could not load page data: ${error.message}`} />;
  }

  if (!data) {
    return <ErrorCard title="Page not found" message={`No document_pages record found for id ${pageId}.`} />;
  }

  const row = data as PageRow;

  if (!row.image_object_path) {
    return <ErrorCard title="Image not available" message="The worker has not yet rendered a page image for this sheet. Check back later." />;
  }

  let gatewayBase: string;
  try {
    gatewayBase = getGatewayBaseUrl();
  } catch (err) {
    return <ErrorCard title="Configuration error" message={err instanceof Error ? err.message : "Gateway URL not configured"} />;
  }

  const imageUrl = `${gatewayBase}/${row.image_object_path.replace(/^\/+/, "")}`;
  const initialTitleblockRectNorm = toInitialNormalisedRect(row);
  const initialAreas = parseFingerprint(row.titleblock_fingerprint);

  return (
    <div className="p-6 max-w-5xl">
      <Link href="/" className="rounded border px-3 py-1 text-sm hover:bg-gray-100 inline-block mb-4">
        &larr; Dashboard
      </Link>

      <h1 className="text-xl font-semibold mb-1">Title-block annotation</h1>
      <p className="text-sm text-gray-600 mb-4">
        Page <code className="text-xs bg-gray-100 px-1 rounded">{row.id}</code>{" "}
        (document <code className="text-xs bg-gray-100 px-1 rounded">{row.document_id}</code>),
        page {row.page_number}. Status:{" "}
        <code className="text-xs bg-gray-100 px-1 rounded">{row.status || "unknown"}</code>
      </p>

      <TitleblockAnnotator
        pageId={row.id}
        imageUrl={imageUrl}
        initialTitleblockRectNorm={initialTitleblockRectNorm}
        initialAreas={initialAreas}
      />
    </div>
  );
}
