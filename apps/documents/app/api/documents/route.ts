// app/api/documents/route.ts
import { NextResponse } from 'next/server';
import { fetchDocumentSummaries } from '../../lib/documents';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectOrEnquiry = url.searchParams.get('projectOrEnquiry') || undefined;
    const drawingNumber = url.searchParams.get('drawingNumber') || undefined;

    const documents = await fetchDocumentSummaries({
      projectOrEnquiry,
      drawingNumber,
    });

    return NextResponse.json({ documents });
  } catch (err: any) {
    console.error('Error in /api/documents:', err);
    return NextResponse.json(
      {
        error: 'Supabase config or server error',
        details: err?.message ?? String(err),
      },
      { status: 500 },
    );
  }
}
