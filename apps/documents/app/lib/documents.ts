// app/lib/documents.ts
import { getSupabaseServer } from './supabaseServer';
import type {
  AttentionCategory,
  DocumentStatus,
  DocumentSummary,
  VersionInfo,
} from './documentTypes';

export type DocumentFilter = {
  projectOrEnquiry?: string;
  drawingNumber?: string;
};

function deriveStatus(
  pageStatusRaw: string | null,
  fileStatusRaw: string | null,
  isSuperseded: boolean,
): { status: DocumentStatus; attentionCategory: AttentionCategory } {
  if (isSuperseded) {
    return { status: 'unmatched', attentionCategory: 'needs_attention' };
  }

  const s = (pageStatusRaw || fileStatusRaw || '').toLowerCase();

  if (!s) {
    return { status: 'pending', attentionCategory: 'needs_attention' };
  }

  if (s.includes('error')) {
    return { status: 'error', attentionCategory: 'needs_attention' };
  }

  if (s.startsWith('pending')) {
    return { status: 'pending', attentionCategory: 'needs_attention' };
  }

  if (s.includes('review') || s.includes('candidate')) {
    return { status: 'revision_check', attentionCategory: 'needs_attention' };
  }

  if (s === 'processed') {
    return { status: 'clean', attentionCategory: 'clean' };
  }

  return { status: 'other', attentionCategory: 'needs_attention' };
}

function mapRowToSummary(row: any): DocumentSummary {
  const file = row.document_files;

  const projectOrEnquiry =
    file?.projectnumber || file?.enquirynumber || '';

  const drawingOrDocNumber =
    row.drawing_number ||
    file?.doc_number ||
    file?.drawing_number ||
    '(un-numbered)';

  const title =
    row.drawing_title ||
    file?.doc_title ||
    '(no title)';

  const revision =
    row.revision ||
    file?.doc_revision ||
    file?.revision ||
    null;

  const pages = file?.page_count ?? 1;

  const { status, attentionCategory } = deriveStatus(
    row.status ?? null,
    file?.status ?? null,
    Boolean(file?.is_superseded),
  );

  // Use our own blob API that serves from HOST_DOC_ROOT
  const thumbnailUrl = row.image_object_path
    ? `/documents/api/blob?path=${encodeURIComponent(row.image_object_path)}`
    : null;

  const pdfUrl = file?.storage_object_path
    ? `/documents/api/blob?path=${encodeURIComponent(file.storage_object_path)}`
    : null;

  return {
    id: row.id,
    projectOrEnquiry,
    drawingOrDocNumber,
    title,
    revision,
    pages,
    status,
    attentionCategory,
    uploadDate: file?.created_at,
    originalFilename: file?.original_filename,
    nasPath: file?.storage_object_path,
    sizeLabel: undefined,
    thumbnailUrl,
    pdfUrl,
  };
}

export async function fetchDocumentSummaries(
  filter: DocumentFilter = {},
): Promise<DocumentSummary[]> {
  const { supabase } = getSupabaseServer();

  let query = supabase
    .from('document_pages')
    .select(
      `
      id,
      created_at,
      document_id,
      page_number,
      image_bucket,
      image_object_path,
      status,
      drawing_number,
      drawing_title,
      revision,
      document_files!inner (
        id,
        created_at,
        enquirynumber,
        projectnumber,
        scope_ref,
        page_count,
        original_filename,
        file_ext,
        file_size_bytes,
        status,
        revision,
        storage_bucket,
        storage_object_path,
        is_superseded,
        doc_number,
        doc_title,
        doc_revision
      )
    `,
    )
    .eq('page_number', 1)
    .eq('document_files.is_superseded', false)
    .order('created_at', { ascending: false });

  if (filter.projectOrEnquiry) {
    query = query.or(
      `document_files.projectnumber.eq.${filter.projectOrEnquiry},document_files.enquirynumber.eq.${filter.projectOrEnquiry}`,
    );
  }

  if (filter.drawingNumber) {
    query = query.ilike('drawing_number', `%${filter.drawingNumber}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Supabase query error (list): ${error.message}`);
  }

  return (data ?? [])
    .map((row: any) => (row.document_files ? mapRowToSummary(row) : null))
    .filter(Boolean) as DocumentSummary[];
}

export async function fetchDocumentWithHistory(
  pageId: string,
): Promise<{ document: DocumentSummary; history: VersionInfo[] }> {
  const { supabase } = getSupabaseServer();

  // 1) Base page + file
  const { data: row, error } = await supabase
    .from('document_pages')
    .select(
      `
      id,
      created_at,
      document_id,
      page_number,
      image_bucket,
      image_object_path,
      status,
      drawing_number,
      drawing_title,
      revision,
      document_files!inner (
        id,
        created_at,
        enquirynumber,
        projectnumber,
        scope_ref,
        page_count,
        original_filename,
        file_ext,
        file_size_bytes,
        status,
        revision,
        storage_bucket,
        storage_object_path,
        is_superseded,
        doc_number,
        doc_title,
        doc_revision
      )
    `,
    )
    .eq('id', pageId)
    .single();

  if (error || !row) {
    const msg = error?.message ?? 'Document page not found';
    const errObj = new Error(msg);
    (errObj as any).code = 'NOT_FOUND';
    throw errObj;
  }

  const document = mapRowToSummary(row);
  const file = row.document_files;

  const drawingNumber =
    row.drawing_number || file?.doc_number || file?.drawing_number || null;
  const projectnumber = file?.projectnumber ?? null;
  const enquirynumber = file?.enquirynumber ?? null;

  // 2) Version history (same drawing + project/enquiry, first page only)
  let history: VersionInfo[] = [];

  if (drawingNumber) {
    let histQuery = supabase
      .from('document_pages')
      .select(
        `
        id,
        created_at,
        revision,
        status,
        drawing_number,
        document_files!inner (
          enquirynumber,
          projectnumber,
          doc_revision,
          revision,
          status,
          is_superseded
        )
      `,
      )
      .eq('page_number', 1)
      .eq('drawing_number', drawingNumber)
      .order('created_at', { ascending: false });

    if (projectnumber) {
      histQuery = histQuery.eq('document_files.projectnumber', projectnumber);
    } else if (enquirynumber) {
      histQuery = histQuery.eq('document_files.enquirynumber', enquirynumber);
    }

    const { data: histRows, error: histError } = await histQuery;

    if (!histError && histRows) {
      history = histRows.map((h: any) => {
        const f = h.document_files;
        const rev =
          h.revision || f?.doc_revision || f?.revision || null;
        const statusStr = h.status || f?.status || 'unknown';

        return {
          id: h.id as string,
          revision: rev,
          uploadDate: h.created_at as string,
          status: statusStr as string,
        };
      });
    } else if (histError) {
      console.error('History query failed:', histError);
    }
  }

  return { document, history };
}
