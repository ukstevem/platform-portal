// app/api/upload/route.ts
import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

export const runtime = 'nodejs';
export const maxDuration = 60;            // seconds (for large files)
export const fetchCache = 'force-no-store';

type ContextType = 'project' | 'enquiry';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function createSupabaseServerClient(): SupabaseClient {
  // Mirrors what you're already doing elsewhere (SUPABASE_SECRET_KEY). :contentReference[oaicite:4]{index=4}
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SECRET_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function getRootDir(): string {
  // Next container should see the same mounted root as workers; fallback for dev.
  return (
    process.env.DOC_NAS_ROOT ||
    process.env.HOST_DOC_ROOT ||
    '/data/input'
  );
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name);
  return base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
}

function getFormText(fd: FormData, ...keys: string[]): string {
  for (const k of keys) {
    const v = fd.get(k);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function isPdf(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'application/pdf' ||
    name.endsWith('.pdf')
  );
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function POST(req: Request) {
  try {
    const fd = await req.formData();

    const contextTypeRaw = getFormText(fd, 'contextType');
    const contextType = contextTypeRaw === 'project' || contextTypeRaw === 'enquiry'
      ? (contextTypeRaw as ContextType)
      : null;

    if (!contextType) {
      return NextResponse.json(
        { ok: false, error: 'Missing/invalid contextType (project|enquiry).' },
        { status: 400 },
      );
    }

    // Accept both camelCase (current UI) and snake_case (DB-ish) keys.
    const projectNumber = getFormText(fd, 'projectNumber', 'projectnumber');
    const enquiryNumber = getFormText(fd, 'enquiryNumber', 'enquirynumber');

    if (contextType === 'project' && !projectNumber) {
      return NextResponse.json(
        { ok: false, error: 'Please provide a project number.' },
        { status: 400 },
      );
    }
    if (contextType === 'enquiry' && !enquiryNumber) {
      return NextResponse.json(
        { ok: false, error: 'Please provide an enquiry number.' },
        { status: 400 },
      );
    }

    const files = fd.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Please select at least one PDF.' },
        { status: 400 },
      );
    }

    const sb = createSupabaseServerClient();
    const root = getRootDir();

    const results: Array<{
      filename: string;
      size: number;
      type: string;
      storagePath: string | null;
      error?: string;
    }> = [];

    for (const file of files) {
      const safeName = sanitizeFilename(file.name);
      const size = file.size ?? 0;
      const type = file.type ?? '';

      try {
        if (!isPdf(file)) {
          throw new Error('Only PDF files are allowed.');
        }

        const documentId = crypto.randomUUID();

        // Store under enquiries/<enq>/... or projects/<proj>/...
        const relDir =
          contextType === 'enquiry'
            ? path.posix.join('enquiries', enquiryNumber)
            : path.posix.join('projects', projectNumber);

        const relPath = path.posix.join(relDir, `${documentId}_${safeName}`);
        const absPath = path.join(root, relPath);

        await fs.mkdir(path.dirname(absPath), { recursive: true });

        const bytes = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(absPath, bytes);

        const hash = sha256(bytes);
        const ext = path.extname(safeName).replace('.', '').toLowerCase() || 'pdf';

        const ins = await sb
          .from('document_files')
          .insert({
            id: documentId,
            enquirynumber: contextType === 'enquiry' ? enquiryNumber : null,
            projectnumber: contextType === 'project' ? projectNumber : null,
            original_filename: safeName,
            file_ext: ext,
            storage_bucket: 'nas',
            storage_object_path: relPath,
            file_size_bytes: bytes.length,
            file_sha256: hash,
            status: 'uploaded',
            is_superseded: false,
            page_count: 1,
            processing_error: null,
          })
          .select('id')
          .single();

        if (ins.error) throw new Error(ins.error.message);

        // Create a document_pages row (page 1) so the document appears in the library.
        // The library query joins document_pages → document_files and filters on page_number = 1.
        const pageIns = await sb
          .from('document_pages')
          .insert({
            document_id: documentId,
            page_number: 1,
            status: 'uploaded',
          });

        if (pageIns.error) {
          console.error('Warning: failed to create document_pages row:', pageIns.error.message);
        }

        results.push({
          filename: safeName,
          size: bytes.length,
          type,
          storagePath: relPath,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        results.push({
          filename: safeName,
          size,
          type,
          storagePath: null,
          error: msg,
        });
      }
    }

    return NextResponse.json({ ok: true, files: results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
