// app/api/blob/route.ts
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const relPath = url.searchParams.get('path');

  if (!relPath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  // Use the same root the containers are configured with
  const root =
    process.env.DOC_NAS_ROOT || // preferred for your setup
    process.env.HOST_DOC_ROOT || // fallback if you ever rename it
    '/data/cad_iot'; // sensible default for doc-client

  if (!root) {
    console.error('No DOC_NAS_ROOT / HOST_DOC_ROOT configured in doc-client');
    return NextResponse.json(
      { error: 'Server not configured for blobs' },
      { status: 500 },
    );
  }

  // Normalise and prevent path traversal
  const cleanRel = relPath.replace(/^[/\\]+/, '');
  const absPath = path.join(root, cleanRel);
  const normalizedRoot = path.resolve(root);
  const normalizedAbs = path.resolve(absPath);

  if (!normalizedAbs.startsWith(normalizedRoot)) {
    console.warn('Blocked invalid blob path', { relPath, absPath });
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const data = await fs.readFile(normalizedAbs);
    const ext = path.extname(cleanRel).toLowerCase();

    let contentType = 'application/octet-stream';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.pdf') contentType = 'application/pdf';

    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('Blob read error', {
      absPath,
      error: (err as any)?.message ?? String(err),
    });
    return NextResponse.json({ error: 'file not found' }, { status: 404 });
  }
}
