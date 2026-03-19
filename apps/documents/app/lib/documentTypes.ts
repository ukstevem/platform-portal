// app/lib/documentTypes.ts

export type AttentionCategory = 'clean' | 'needs_attention';

export type DocumentStatus =
  | 'clean'
  | 'needs_attention'
  | 'unmatched'
  | 'revision_check'
  | 'pending'
  | 'error'
  | 'other';

export type VersionInfo = {
  id: string;
  revision: string | null;
  uploadDate: string;
  status: string;
};

export type DocumentSummary = {
  id: string; // document_pages.id (page id)
  projectOrEnquiry: string;
  drawingOrDocNumber: string;
  title: string;
  revision: string | null;
  pages: number;
  status: DocumentStatus;
  attentionCategory: AttentionCategory;
  uploadDate?: string;
  originalFilename?: string;
  nasPath?: string;
  sizeLabel?: string;
  thumbnailUrl?: string | null;
  pdfUrl?: string | null;
  versionHistory?: VersionInfo[];
};
