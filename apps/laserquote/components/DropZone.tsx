"use client";

import { useCallback, useState, useRef } from "react";

type UploadResult = { id: string; fileName: string } | { error: string };

type DropZoneProps = {
  customer: string;
  material: string;
  grade: string;
  sheetPrice: string;
  materialRate: string;
  incoterms: string;
  leadTime: string;
  premium: boolean;
  remCharge: boolean;
  onUploaded?: () => void;
};

export function DropZone({
  customer,
  material,
  grade,
  sheetPrice,
  materialRate,
  incoterms,
  leadTime,
  premium,
  remCharge,
  onUploaded,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const valid = customer.trim() !== "" && material !== "" && grade.trim() !== "";

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!valid) return;
      setUploading(true);
      setResults([]);

      const form = new FormData();
      for (const file of Array.from(files)) {
        form.append("files", file);
      }
      form.append("customer", customer);
      form.append("material", material);
      form.append("grade", grade);
      form.append("sheetPrice", sheetPrice);
      form.append("materialRate", materialRate);
      form.append("incoterms", incoterms);
      form.append("leadTime", leadTime);
      form.append("premium", String(premium));
      form.append("remCharge", String(remCharge));

      try {
        const res = await fetch("/laserquote/api/upload", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) {
          setResults([{ error: data.error ?? "Upload failed" }]);
        } else {
          setResults([
            {
              id: data.id,
              fileName: `${data.fileCount} file(s) queued`,
            },
          ]);
          onUploaded?.();
        }
      } catch {
        setResults([{ error: "Network error" }]);
      }

      setUploading(false);
    },
    [customer, material, grade, sheetPrice, materialRate, incoterms, leadTime, premium, remCharge, valid, onUploaded]
  );

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
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => valid && inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center transition-colors
          ${!valid ? "border-gray-200 bg-gray-50 cursor-not-allowed opacity-60" : dragging ? "border-sky-400 bg-sky-50 cursor-pointer" : "border-gray-300 hover:border-gray-400 bg-white cursor-pointer"}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.nc"
          multiple
          className="hidden"
          disabled={!valid}
          onChange={(e) => e.target.files?.length && uploadFiles(e.target.files)}
        />
        <p className="text-lg font-medium" style={{ color: "var(--pss-navy)" }}>
          {uploading
            ? "Uploading..."
            : valid
              ? "Drop Radan CSV / NC files here"
              : "Fill in job details above first"}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Upload one or more nesting output files for the same job
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
              {"error" in r ? r.error : `${r.fileName} for processing`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
