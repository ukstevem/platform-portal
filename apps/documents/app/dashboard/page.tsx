"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  DragEvent,
  ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";

const BASE = "/documents";

// ── Types ────────────────────────────────────────────

type ViewMode = "library" | "pictorial" | "projects";

type DocumentStatus =
  | "clean"
  | "needs_attention"
  | "unmatched"
  | "revision_check"
  | "pending"
  | "error"
  | "other";

type AttentionCategory = "clean" | "needs_attention";

type VersionInfo = {
  id: string;
  revision: string | null;
  uploadDate: string;
  status: string;
};

type DocumentSummary = {
  id: string;
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

// ── Status badge ─────────────────────────────────────

const STATUS_CONFIG: Record<DocumentStatus, { label: string; cls: string }> = {
  clean:           { label: "Clean",          cls: "badge-green" },
  needs_attention: { label: "Needs attention", cls: "badge-yellow" },
  unmatched:       { label: "Unmatched",       cls: "badge-orange" },
  revision_check:  { label: "Revision check",  cls: "badge-blue" },
  pending:         { label: "Pending",         cls: "badge-gray" },
  error:           { label: "Error",           cls: "badge-red" },
  other:           { label: "Other",           cls: "badge-gray" },
};

function StatusBadge({ status }: { status: DocumentStatus }) {
  const { label, cls } = STATUS_CONFIG[status] ?? STATUS_CONFIG.other;
  return <span className={`badge ${cls}`}>{label}</span>;
}

// ── Upload bar ───────────────────────────────────────

function UploadBar({
  onUpload,
}: {
  onUpload: (files: File[], meta: { type: "project" | "enquiry"; value: string }) => Promise<void>;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [metaType, setMetaType] = useState<"project" | "enquiry">("enquiry");
  const [metaValue, setMetaValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const runUpload = useCallback(
    async (filesList: FileList | null) => {
      setError("");
      setOkMsg("");
      const files = filesList
        ? Array.from(filesList).filter(
            (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
          )
        : [];
      if (files.length === 0) { setError("Select or drop at least one PDF."); return; }
      if (!metaValue.trim()) { setError(`Enter a ${metaType} number first.`); return; }

      setBusy(true);
      try {
        await onUpload(files, { type: metaType, value: metaValue.trim() });
        setOkMsg(`Uploaded ${files.length} file(s) to ${metaType} ${metaValue.trim()}.`);
        setTimeout(() => setOkMsg(""), 5000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [metaType, metaValue, onUpload],
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1 text-xs">
        {(["project", "enquiry"] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={busy}
            className={`px-2 py-0.5 rounded border cursor-pointer capitalize ${
              metaType === t ? "pss-toggle-active" : "bg-white text-gray-700"
            }`}
            onClick={() => setMetaType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <input
        className="border rounded px-2 py-1 text-xs w-36"
        disabled={busy}
        value={metaValue}
        onChange={(e) => setMetaValue(e.target.value)}
        placeholder={metaType === "project" ? "Project #" : "Enquiry #"}
      />

      <label
        className={`border rounded px-3 py-1 text-xs cursor-pointer ${
          dragActive ? "bg-blue-50 border-blue-400" : "bg-white"
        } ${busy ? "opacity-60 cursor-not-allowed" : ""}`}
        onDrop={(e: DragEvent<HTMLElement>) => { e.preventDefault(); setDragActive(false); void runUpload(e.dataTransfer.files); }}
        onDragOver={(e: DragEvent<HTMLElement>) => { e.preventDefault(); if (!dragActive) setDragActive(true); }}
        onDragLeave={(e: DragEvent<HTMLElement>) => { e.preventDefault(); setDragActive(false); }}
      >
        <span className="font-medium">{busy ? "Uploading\u2026" : "Upload"}</span>
        <span className="ml-2 text-[11px] text-gray-500">Drag & drop or click</span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => { void runUpload(e.target.files); e.target.value = ""; }}
          accept=".pdf,application/pdf"
          disabled={busy}
        />
      </label>

      {error && <span className="text-xs text-red-600">{error}</span>}
      {okMsg && <span className="text-xs text-green-700">{okMsg}</span>}
    </div>
  );
}

// ── Document table (reused by Library & Project views) ──

function DocTable({
  documents,
  selectedId,
  onSelect,
  onTag,
  showProject = true,
}: {
  documents: DocumentSummary[];
  selectedId: string | null;
  onSelect: (doc: DocumentSummary) => void;
  onTag: (doc: DocumentSummary) => void;
  showProject?: boolean;
}) {
  if (documents.length === 0) {
    return (
      <div className="text-gray-500 py-6 text-center text-xs border rounded bg-white">
        No documents match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead className="bg-gray-50 border-b text-[11px] uppercase tracking-wide text-gray-600">
          <tr>
            {showProject && <th className="text-left px-2 py-1.5 border-r">Project / Enquiry</th>}
            <th className="text-left px-2 py-1.5 border-r">Number</th>
            <th className="text-left px-2 py-1.5 border-r">Title</th>
            <th className="text-left px-2 py-1.5 border-r">Rev</th>
            <th className="text-left px-2 py-1.5 border-r">Pages</th>
            <th className="text-left px-2 py-1.5 border-r">Status</th>
            <th className="text-left px-2 py-1.5">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr
              key={doc.id}
              className={`border-b cursor-pointer ${
                doc.id === selectedId ? "bg-blue-100" : "hover:bg-blue-50"
              }`}
              onClick={() => onSelect(doc)}
            >
              {showProject && <td className="px-2 py-1.5">{doc.projectOrEnquiry}</td>}
              <td className="px-2 py-1.5 font-mono">{doc.drawingOrDocNumber}</td>
              <td className="px-2 py-1.5">{doc.title}</td>
              <td className="px-2 py-1.5">{doc.revision ?? "-"}</td>
              <td className="px-2 py-1.5 text-center">{doc.pages}</td>
              <td className="px-2 py-1.5"><StatusBadge status={doc.status} /></td>
              <td className="px-2 py-1.5">
                <button
                  type="button"
                  className="text-[11px] px-2 py-0.5 border rounded mr-1 hover:bg-gray-100 cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); onSelect(doc); }}
                >
                  Details
                </button>
                <button
                  type="button"
                  className="text-[11px] px-2 py-0.5 border rounded hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                  disabled={!doc.pages || doc.pages <= 0}
                  onClick={(e) => { e.stopPropagation(); onTag(doc); }}
                >
                  Tag template
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Pictorial view ───────────────────────────────────

function PictorialView({
  documents,
  selectedId,
  onSelect,
  onTag,
}: {
  documents: DocumentSummary[];
  selectedId: string | null;
  onSelect: (doc: DocumentSummary) => void;
  onTag: (doc: DocumentSummary) => void;
}) {
  if (documents.length === 0) {
    return (
      <div className="text-gray-500 py-6 text-center text-xs">
        No documents match the current filters.
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 p-2">
      {documents.map((doc) => (
        <div
          key={doc.id}
          className={`border rounded shadow-sm bg-white cursor-pointer flex flex-col ${
            doc.id === selectedId ? "ring-2 ring-blue-400" : ""
          }`}
          onClick={() => onSelect(doc)}
        >
          <div className="bg-gray-100 border-b h-40 flex items-center justify-center overflow-hidden">
            {doc.thumbnailUrl ? (
              <img src={doc.thumbnailUrl} alt={doc.title} className="object-contain max-h-full" />
            ) : (
              <span className="text-xs text-gray-400">No preview</span>
            )}
          </div>
          <div className="p-2 space-y-1">
            <div className="text-[11px] text-gray-500">{doc.projectOrEnquiry}</div>
            <div className="font-mono text-xs font-semibold">
              {doc.drawingOrDocNumber}
              {doc.revision && (
                <span className="ml-1 text-[10px] text-gray-500">(Rev {doc.revision})</span>
              )}
            </div>
            <div className="text-xs text-gray-700 line-clamp-2">{doc.title}</div>
            <div className="flex items-center justify-between mt-1">
              <StatusBadge status={doc.status} />
              <button
                type="button"
                className="text-[11px] px-2 py-0.5 border rounded hover:bg-gray-100 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onTag(doc); }}
              >
                Tag
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────

function DetailPanel({
  document,
  loading,
}: {
  document: DocumentSummary | null;
  loading: boolean;
}) {
  if (!document) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400 p-4">
        Select a drawing or document to see details.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-3 py-2">
        <div className="text-xs text-gray-500">{document.projectOrEnquiry}</div>
        <div className="font-semibold text-sm">
          <span className="font-mono">{document.drawingOrDocNumber}</span>
          {document.revision && (
            <span className="ml-1 text-xs text-gray-500">(Rev {document.revision})</span>
          )}
        </div>
        <div className="text-xs text-gray-700">{document.title}</div>
      </div>

      <div className="px-3 py-2 border-b flex items-start justify-between gap-3">
        <div className="space-y-1 text-xs">
          <div><span className="text-gray-500 mr-1">Pages:</span>{document.pages}</div>
          <div><span className="text-gray-500 mr-1">Status:</span><StatusBadge status={document.status} /></div>
          {document.uploadDate && (
            <div><span className="text-gray-500 mr-1">Uploaded:</span>{new Date(document.uploadDate).toLocaleString()}</div>
          )}
          {document.originalFilename && (
            <div><span className="text-gray-500 mr-1">File:</span>{document.originalFilename}</div>
          )}
          {document.nasPath && (
            <div className="break-all"><span className="text-gray-500 mr-1">NAS:</span>{document.nasPath}</div>
          )}
        </div>
        {document.pdfUrl && (
          <a
            href={document.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50 shrink-0"
          >
            Open PDF
          </a>
        )}
      </div>

      {document.thumbnailUrl && (
        <div className="px-3 py-2 border-b bg-gray-50 flex justify-center">
          <button
            type="button"
            className="border rounded bg-white max-w-full max-h-64 overflow-hidden cursor-pointer"
            onClick={() => window.open(document.pdfUrl ?? document.thumbnailUrl!, "_blank")}
          >
            <img src={document.thumbnailUrl} alt={document.title} className="max-h-64 max-w-full object-contain" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto px-3 py-2">
        <h3 className="text-xs font-semibold mb-1">Version history</h3>
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <span className="platform-spinner" />
            <span className="text-xs text-gray-500">Loading history...</span>
          </div>
        ) : document.versionHistory && document.versionHistory.length > 0 ? (
          <ul className="text-xs space-y-1">
            {document.versionHistory.map((v) => (
              <li key={v.id} className="flex justify-between gap-2">
                <span>Rev {v.revision ?? "-"} ({v.status})</span>
                <span className="text-gray-500">{new Date(v.uploadDate).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-gray-400">No version history found.</div>
        )}
      </div>
    </div>
  );
}

// ── Main dashboard ───────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("library");
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [filterProject, setFilterProject] = useState("");
  const [filterText, setFilterText] = useState("");
  const [projectFilterForProjectsView, setProjectFilterForProjectsView] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load documents
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${BASE}/api/documents`);
        if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
        const body = await res.json();
        if (cancelled) return;
        const docs: DocumentSummary[] = body.documents ?? [];
        setDocuments(docs);
        if (docs.length > 0) setSelectedDoc(docs[0]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load documents");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const doc of documents) if (doc.projectOrEnquiry) set.add(doc.projectOrEnquiry);
    return Array.from(set).sort();
  }, [documents]);

  const filtered = useMemo(() => {
    const proj = view === "projects" ? projectFilterForProjectsView : filterProject;
    return documents.filter((doc) => {
      if (proj && doc.projectOrEnquiry !== proj) return false;
      if (view !== "projects" && filterText) {
        if (!doc.drawingOrDocNumber.toLowerCase().includes(filterText.toLowerCase())) return false;
      }
      return true;
    });
  }, [documents, view, filterProject, filterText, projectFilterForProjectsView]);

  const handleSelectDoc = useCallback((doc: DocumentSummary) => {
    setSelectedDoc(doc);
    setDetailLoading(true);
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/documents/${doc.id}`);
        if (!res.ok) { setDetailLoading(false); return; }
        const body = await res.json();
        setSelectedDoc((prev) => {
          if (!prev || prev.id !== doc.id) return prev;
          return { ...prev, ...body.document, versionHistory: body.history };
        });
      } catch {
        // detail fetch is non-critical
      } finally {
        setDetailLoading(false);
      }
    })();
  }, []);

  const handleTagTemplate = useCallback(
    (doc: DocumentSummary) => {
      if (!doc?.id) return;
      router.push(`/pages/${doc.id}/titleblock`);
    },
    [router],
  );

  const handleUpload = useCallback(
    async (files: File[], meta: { type: "project" | "enquiry"; value: string }) => {
      const fd = new FormData();
      fd.append("contextType", meta.type);
      if (meta.type === "project") fd.append("projectNumber", meta.value);
      else fd.append("enquiryNumber", meta.value);
      for (const f of files) fd.append("files", f);

      const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Upload failed (${res.status})`);

      const listRes = await fetch(`${BASE}/api/documents`);
      if (listRes.ok) {
        const listBody = await listRes.json();
        const docs: DocumentSummary[] = listBody.documents ?? [];
        setDocuments(docs);
        setSelectedDoc((prev) => {
          if (prev && docs.some((d) => d.id === prev.id)) return prev;
          return docs[0] ?? null;
        });
      }
    },
    [],
  );

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b px-4 py-2 flex flex-col sm:flex-row sm:items-center gap-2 bg-white">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold whitespace-nowrap">Document dashboard</h1>
          <div className="flex gap-1 text-xs">
            {(["library", "pictorial", "projects"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`px-2 py-0.5 rounded border cursor-pointer capitalize ${
                  view === v ? "pss-toggle-active" : "bg-white text-gray-700"
                }`}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="sm:ml-auto">
          <UploadBar onUpload={handleUpload} />
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="alert alert-error mx-4 mt-2">
          {error}
          <button
            type="button"
            className="ml-auto text-red-700 hover:text-red-900 cursor-pointer text-sm"
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <span className="platform-spinner platform-spinner-lg" />
            <p className="text-sm text-gray-500">Loading documents...</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: filters + view */}
          <div className="flex flex-col flex-3 border-r bg-gray-50">
            <div className="flex items-center gap-3 px-3 py-2 border-b bg-white flex-wrap">
              {view !== "projects" ? (
                <>
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] text-gray-600">Project / Enquiry</label>
                    <select
                      className="border rounded px-2 py-0.5 text-xs"
                      value={filterProject}
                      onChange={(e) => setFilterProject(e.target.value)}
                    >
                      <option value="">All</option>
                      {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] text-gray-600">Drawing / doc #</label>
                    <input
                      className="border rounded px-2 py-0.5 text-xs"
                      value={filterText}
                      onChange={(e) => setFilterText(e.target.value)}
                      placeholder="Filter by number"
                    />
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-gray-600">Project / Enquiry</label>
                  <select
                    className="border rounded px-2 py-0.5 text-xs"
                    value={projectFilterForProjectsView}
                    onChange={(e) => setProjectFilterForProjectsView(e.target.value)}
                  >
                    <option value="">Select&hellip;</option>
                    {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
              <div className="text-[11px] text-gray-400 ml-auto">
                {filtered.length} document{filtered.length !== 1 ? "s" : ""}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {view === "library" && (
                <DocTable documents={filtered} selectedId={selectedDoc?.id ?? null} onSelect={handleSelectDoc} onTag={handleTagTemplate} />
              )}
              {view === "pictorial" && (
                <PictorialView documents={filtered} selectedId={selectedDoc?.id ?? null} onSelect={handleSelectDoc} onTag={handleTagTemplate} />
              )}
              {view === "projects" && !projectFilterForProjectsView && (
                <div className="flex items-center justify-center text-xs text-gray-500 py-12">
                  Select a project or enquiry from the dropdown above.
                </div>
              )}
              {view === "projects" && projectFilterForProjectsView && (
                <div className="p-2 space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-red-600 mb-2">Items needing attention</h3>
                    <DocTable documents={filtered.filter((d) => d.attentionCategory === "needs_attention")} selectedId={selectedDoc?.id ?? null} onSelect={handleSelectDoc} onTag={handleTagTemplate} showProject={false} />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-green-700 mb-2">Clean / processed</h3>
                    <DocTable documents={filtered.filter((d) => d.attentionCategory === "clean")} selectedId={selectedDoc?.id ?? null} onSelect={handleSelectDoc} onTag={handleTagTemplate} showProject={false} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: details */}
          <div className="flex-col flex-2 bg-white hidden md:flex">
            <DetailPanel document={selectedDoc} loading={detailLoading} />
          </div>
        </div>
      )}
    </div>
  );
}
