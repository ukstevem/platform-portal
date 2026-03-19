// app/api/documents/[id]/route.ts
import { NextResponse } from 'next/server';
import { fetchDocumentWithHistory } from '../../../lib/documents';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const pageId = id.trim(); // or documentId, depending on what your fetch expects

    if (!pageId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const { document, history } = await fetchDocumentWithHistory(pageId);
    return NextResponse.json({ document, history });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 },
    );
  }
}
