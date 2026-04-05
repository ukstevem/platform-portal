"use client";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  complete: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  draft: "bg-gray-100 text-gray-700",
  issued: "bg-blue-100 text-blue-800",
  revised: "bg-amber-100 text-amber-800",
  won: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  ready_for_collection: "bg-emerald-100 text-emerald-800",
  delivered: "bg-teal-100 text-teal-800",
  cancelled: "bg-gray-100 text-gray-500",
  lost: "bg-orange-100 text-orange-800",
};

const STATUS_LABELS: Record<string, string> = {
  won: "In Production",
  ready_for_collection: "Ready for Collection",
};

type StatusBadgeProps = {
  status: string;
  error?: string | null;
};

export function StatusBadge({ status, error }: StatusBadgeProps) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}
      title={error ?? undefined}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
