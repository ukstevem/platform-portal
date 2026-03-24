"use client";

import { useCallback, useState, useRef } from "react";

type UploadResult = { id: string; fileName: string } | { error: string };

export function DropZone() {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    setResults([]);
    const batch: UploadResult[] = [];

    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);

      try {
        const res = await fetch("/scanner/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          batch.push({ error: `${file.name}: ${data.error ?? "Upload failed"}` });
        } else {
          batch.push({ id: data.id, fileName: file.name });
        }
      } catch {
        batch.push({ error: `${file.name}: Network error` });
      }
    }

    setResults(batch);
    setUploading(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
          ${dragging ? "border-sky-400 bg-sky-50" : "border-gray-300 hover:border-gray-400 bg-white"}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && uploadFiles(e.target.files)}
        />
        <div className="text-4xl mb-3">📄</div>
        <p className="text-lg font-medium" style={{ color: "var(--pss-navy)" }}>
          {uploading ? "Uploading..." : "Drop scanned documents here"}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          PDF or image files with a QR code on the first page
        </p>
        <p className="text-xs text-gray-400 mt-2">or click to browse</p>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div
              key={i}
              className={`px-4 py-2 rounded text-sm ${
                "error" in r ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
              }`}
            >
              {"error" in r ? r.error : `✓ ${r.fileName} queued for processing`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
