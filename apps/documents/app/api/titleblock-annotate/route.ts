// app/api/titleblock-annotate/route.ts

import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

type FieldKey = 'drawing_number' | 'drawing_title' | 'revision' | 'other';

interface TitleblockRectPayload {
  // Normalised to page: 0–1
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AreaPayload {
  // Normalised to title-block: 0–1
  field: FieldKey;
  x_rel: number;
  y_rel: number;
  width_rel: number;
  height_rel: number;
}

interface AnnotatePayload {
  pageId: string;
  titleblock: TitleblockRectPayload;
  areas: AreaPayload[];
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function createSupabaseClient(): SupabaseClient {
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SECRET_KEY');
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

function validatePayload(payload: Partial<AnnotatePayload>): string | null {
  if (!payload.pageId) {
    return 'pageId is required.';
  }
  if (!payload.titleblock) {
    return 'titleblock is required.';
  }

  const tb = payload.titleblock;
  if (
    typeof tb.x !== 'number' ||
    typeof tb.y !== 'number' ||
    typeof tb.width !== 'number' ||
    typeof tb.height !== 'number'
  ) {
    return 'titleblock x, y, width, height must be numbers.';
  }
  if (tb.width <= 0 || tb.height <= 0) {
    return 'titleblock width and height must be positive.';
  }
  if (
    tb.x < 0 ||
    tb.x > 1 ||
    tb.y < 0 ||
    tb.y > 1 ||
    tb.width <= 0 ||
    tb.width > 1 ||
    tb.height <= 0 ||
    tb.height > 1
  ) {
    return 'titleblock x, y, width, height must be between 0 and 1.';
  }

  if (!Array.isArray(payload.areas)) {
    // Areas are optional
    return null;
  }

  for (const a of payload.areas) {
    if (!a) {
      continue;
    }
    if (
      a.field !== 'drawing_number' &&
      a.field !== 'drawing_title' &&
      a.field !== 'revision' &&
      a.field !== 'other'
    ) {
      return 'area field must be one of drawing_number, drawing_title, revision, other.';
    }
    if (
      typeof a.x_rel !== 'number' ||
      typeof a.y_rel !== 'number' ||
      typeof a.width_rel !== 'number' ||
      typeof a.height_rel !== 'number'
    ) {
      return 'area x_rel, y_rel, width_rel, height_rel must be numbers.';
    }
    if (
      a.x_rel < 0 ||
      a.x_rel > 1 ||
      a.y_rel < 0 ||
      a.y_rel > 1 ||
      a.width_rel <= 0 ||
      a.width_rel > 1 ||
      a.height_rel <= 0 ||
      a.height_rel > 1
    ) {
      return 'area x_rel, y_rel, width_rel, height_rel must be between 0 and 1 (width/height > 0).';
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AnnotatePayload>;
    const errorMsg = validatePayload(body);

    if (errorMsg) {
      return NextResponse.json(
        { ok: false, error: errorMsg },
        { status: 400 },
      );
    }

    const payload = body as AnnotatePayload;
    const supabase = createSupabaseClient();

    const fingerprint = {
      version: 2,
      areas: payload.areas ?? [],
    };

    const { error: updateError } = await supabase
      .from('document_pages')
      .update({
        titleblock_x: payload.titleblock.x,
        titleblock_y: payload.titleblock.y,
        titleblock_width: payload.titleblock.width,
        titleblock_height: payload.titleblock.height,
        titleblock_fingerprint: fingerprint,
        titleblock_fingerprint_version: 2,
        status: 'tagged',
      })
      .eq('id', payload.pageId);

    if (updateError) {
      console.error(
        'Error updating document_pages titleblock + fingerprint:',
        updateError,
      );
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, fingerprint });
  } catch (error) {
    console.error('Error in POST /api/titleblock-annotate:', error);
    return NextResponse.json(
      { ok: false, error: 'Unexpected server error.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { pageId?: string };

    if (!body.pageId) {
      return NextResponse.json(
        { ok: false, error: 'pageId is required.' },
        { status: 400 },
      );
    }

    const supabase = createSupabaseClient();

    const { error: updateError } = await supabase
      .from('document_pages')
      .update({
        titleblock_x: null,
        titleblock_y: null,
        titleblock_width: null,
        titleblock_height: null,
        titleblock_fingerprint: null,
        titleblock_fingerprint_version: null,
        // status is left alone on clear
      })
      .eq('id', body.pageId);

    if (updateError) {
      console.error(
        'Error clearing document_pages titleblock + fingerprint:',
        updateError,
      );
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in DELETE /api/titleblock-annotate:', error);
    return NextResponse.json(
      { ok: false, error: 'Unexpected server error.' },
      { status: 500 },
    );
  }
}
