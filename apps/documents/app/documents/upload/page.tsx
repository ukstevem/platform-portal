"use client";

import React, { useMemo, useState } from "react";

type ContextType = "project" | "enquiry";

interface UploadResult {
  filename: string;
  size: number;
  type: string;
  storagePath: string | null;
  error?: string;
}

function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function uploadWithProgress(formData: FormData, onProgress: (pct: number) => void) {
  return new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/documents/api/upload");
    xhr.timeout = 300000; // 5 minute timeout
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      try { resolve(JSON.parse(xhr.responseText)); }
      catch { reject(new Error("Bad JSON response from /api/upload")); }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(formData);
  });
}

export default function UploadPage() {
  const [contextType, setContextType] = useState<ContextType>("project");
  const [projectNumber, setProjectNumber] = useState("");
  const [enquiryNumber, setEnquiryNumber] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<UploadResult[]>([]);

  const pickedFiles = useMemo(() => (files ? Array.from(files) : []), [files]);
  const totalBytes = useMemo(() => pickedFiles.reduce((sum, f) => sum + (f.size || 0), 0), [pickedFiles]);

  function validate(): string | null {
    if (!files || files.length === 0) return "Select at least one PDF.";
    if (contextType === "project" && !projectNumber.trim()) return "Enter a project number.";
    if (contextType === "enquiry" && !enquiryNumber.trim()) return "Enter an enquiry number.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setResults([]);
    setProgress(0);

    const v = validate();
    if (v) { setError(v); return; }
    if (!files) { setError("No files selected."); return; }

    const fd = new FormData();
    fd.append("contextType", contextType);
    if (contextType === "project") fd.append("projectNumber", projectNumber.trim());
    if (contextType === "enquiry") fd.append("enquiryNumber", enquiryNumber.trim());
    for (const f of Array.from(files)) fd.append("files", f);

    setSubmitting(true);
    try {
      const data = await uploadWithProgress(fd, setProgress);
      if (!data || data.ok !== true) {
        setError(data?.error || "Upload API returned an error.");
        return;
      }

      const mapped: UploadResult[] = (data.files || []).map((f: any) => ({
        filename: f.filename,
        size: f.size,
        type: f.type,
        storagePath: f.storagePath,
        error: f.error,
      }));

      setResults(mapped);
      const ctxLabel = contextType === "project"
        ? `project ${projectNumber.trim()}`
        : `enquiry ${enquiryNumber.trim()}`;
      setMessage(`Uploaded ${mapped.length} file(s) linked to ${ctxLabel}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected upload error.");
    } finally {
      setSubmitting(false);
      setTimeout(() => setProgress(0), 600);
    }
  }

  return (
    <div className="max-w-3xl p-6">
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-xl font-semibold">Upload</h1>
        <span className="text-sm text-gray-500">
          PDFs &rarr; NAS + <code className="text-xs">document_files</code>
        </span>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="border rounded-lg p-4 space-y-4 bg-white">
          {/* Context type + number */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex gap-2">
              {(["project", "enquiry"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={submitting}
                  className={`px-3 py-1.5 rounded border text-sm cursor-pointer capitalize ${
                    contextType === t
                      ? "pss-toggle-active"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  } disabled:opacity-60`}
                  onClick={() => setContextType(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <input
              className="flex-1 border rounded px-3 py-1.5 text-sm"
              value={contextType === "project" ? projectNumber : enquiryNumber}
              onChange={(e) =>
                contextType === "project"
                  ? setProjectNumber(e.target.value)
                  : setEnquiryNumber(e.target.value)
              }
              placeholder={contextType === "project" ? "Project number (e.g. 10001)" : "Enquiry number (e.g. 55555)"}
              disabled={submitting}
            />
          </div>

          {/* File picker + submit */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="flex-1">
              <input
                type="file"
                accept=".pdf,application/pdf"
                multiple
                disabled={submitting}
                onChange={(e) => setFiles(e.target.files)}
                className="text-sm"
              />
              <div className="mt-1 text-xs text-gray-500">
                {pickedFiles.length > 0 ? (
                  <>Selected <strong>{pickedFiles.length}</strong> file(s) &middot; {formatMb(totalBytes)}</>
                ) : (
                  "Select one or more PDFs"
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="pss-btn px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Uploading\u2026" : "Upload"}
            </button>
          </div>

          {/* Progress bar */}
          {submitting && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full transition-[width] duration-150" style={{ background: "var(--pss-navy)" }}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-xs text-gray-500">{progress}%</div>
            </div>
          )}

          {/* Messages */}
          {error && (
            <div className="alert alert-error">
              {error}
              <button type="button" className="ml-auto opacity-50 hover:opacity-100 cursor-pointer" onClick={() => setError("")}>✕</button>
            </div>
          )}
          {message && <div className="alert alert-success">{message}</div>}
        </div>
      </form>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-4 border rounded-lg p-4 bg-white space-y-2">
          <div className="text-sm font-semibold mb-2">Results</div>
          {results.map((r) => {
            const ok = !r.error && r.storagePath;
            return (
              <div
                key={`${r.filename}-${r.storagePath ?? "x"}`}
                className={`flex items-start justify-between gap-3 p-3 rounded-lg border ${
                  ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.filename}</div>
                  <div className="text-xs text-gray-500">
                    {formatMb(r.size)} &middot; {r.type || "unknown"}
                    {ok && <> &middot; <code className="text-xs">{r.storagePath}</code></>}
                  </div>
                  {!ok && r.error && <div className="text-xs text-red-600 mt-0.5">{r.error}</div>}
                </div>
                <div className={`text-sm font-bold shrink-0 ${ok ? "text-green-700" : "text-red-700"}`}>
                  {ok ? "OK" : "FAIL"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
