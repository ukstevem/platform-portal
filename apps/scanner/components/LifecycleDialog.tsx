"use client";

import { useState } from "react";

const DOC_SERVICE_URL = process.env.NEXT_PUBLIC_DOC_SERVICE_URL ?? "";

type Props = {
  jobId: string;
  currentStatus: string;
  onClose: () => void;
  onUpdated: () => void;
};

const LIFECYCLE_OPTIONS = [
  { value: "superseded", label: "Superseded", description: "Replaced by a newer version" },
  { value: "deactivated", label: "Deactivated", description: "Removed/invalid — kept for audit" },
  { value: "archived", label: "Archived", description: "Retention period reached" },
  { value: "active", label: "Active", description: "Restore to active status" },
];

export function LifecycleDialog({ jobId, currentStatus, onClose, onUpdated }: Props) {
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [supersededBy, setSupersededBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = LIFECYCLE_OPTIONS.filter((o) => o.value !== currentStatus);
  const isSuperseded = status === "superseded";

  const handleSubmit = async () => {
    if (!status) return;
    if (isSuperseded && !supersededBy.trim()) {
      setError("Replacement document ID is required when superseding");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${DOC_SERVICE_URL}/api/scan/${jobId}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reason: reason || undefined,
          notes: notes || undefined,
          superseded_by: isSuperseded ? supersededBy.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update lifecycle");
        return;
      }
      onUpdated();
    } catch {
      setError("Failed to connect to document service");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--pss-navy)" }}>
          Change Document Status
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Status</label>
            <div className="space-y-2">
              {available.map((o) => (
                <label
                  key={o.value}
                  className={`flex items-start gap-3 p-2 rounded border cursor-pointer ${
                    status === o.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="lifecycle"
                    value={o.value}
                    checked={status === o.value}
                    onChange={(e) => setStatus(e.target.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">{o.label}</div>
                    <div className="text-xs text-gray-500">{o.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Superseded by — required when superseding */}
          {isSuperseded && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Replacement Document ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={supersededBy}
                onChange={(e) => setSupersededBy(e.target.value)}
                placeholder="Paste the scan ID of the replacement document"
                className="w-full border rounded px-3 py-2 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                The UUID of the new document that replaces this one
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Replaced by updated inspection from 2026-W14"
              className="w-full border rounded px-3 py-2 text-sm h-16 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes for audit trail"
              className="w-full border rounded px-3 py-2 text-sm h-16 resize-none"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !status || (isSuperseded && !supersededBy.trim())}
            className="px-4 py-2 text-sm text-white rounded disabled:opacity-50"
            style={{ backgroundColor: "var(--pss-navy)" }}
          >
            {submitting ? "Updating..." : "Update Status"}
          </button>
        </div>
      </div>
    </div>
  );
}
