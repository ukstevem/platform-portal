"use client";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-100 text-yellow-800",
  scanning: "bg-blue-100 text-blue-800",
  filed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
};

const ERROR_LABELS: Record<string, string> = {
  DUPLICATE_EXACT: "Duplicate",
  DUPLICATE_LOGICAL: "Already filed",
  NO_QR_CODE: "No QR code",
  UNKNOWN_TYPE_CODE: "Unknown type",
  UNKNOWN_ASSET: "Unknown asset",
  UNKNOWN_DOC_CODE: "Unknown doc code",
  DOC_TYPE_MISMATCH: "Type mismatch",
  FILE_NOT_FOUND: "File missing",
  PROCESSING_ERROR: "Processing error",
};

const WARNING_CODES = ["DUPLICATE_EXACT", "DUPLICATE_LOGICAL"];

type StatusBadgeProps = {
  status: string;
  errorCode?: string | null;
  error?: string | null;
};

export function StatusBadge({ status, errorCode, error }: StatusBadgeProps) {
  const isWarning = errorCode && WARNING_CODES.includes(errorCode);
  const colorKey = isWarning ? "warning" : status;
  const label = errorCode ? ERROR_LABELS[errorCode] ?? errorCode : status;

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[colorKey] ?? "bg-gray-100 text-gray-700"}`}
      title={error ?? undefined}
    >
      {status === "error" || status === "warning" ? label : status}
    </span>
  );
}
