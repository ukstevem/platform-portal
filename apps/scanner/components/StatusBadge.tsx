"use client";

const COLORS: Record<string, string> = {
  queued: "bg-yellow-100 text-yellow-800",
  scanning: "bg-blue-100 text-blue-800",
  filed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

export function StatusBadge({ status, error }: { status: string; error?: string | null }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${COLORS[status] ?? "bg-gray-100 text-gray-700"}`}
      title={error ?? undefined}
    >
      {status}
      {status === "error" && error ? ` — ${error}` : ""}
    </span>
  );
}
