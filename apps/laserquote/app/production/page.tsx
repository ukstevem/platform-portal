"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";

type Quote = {
  id: number;
  quote_number: number;
  import_id: string | null;
  customer: string;
  material: string | null;
  grade: string | null;
  thickness: number | null;
  status: string;
  total_value: number | null;
  created_at: string;
  updated_at: string;
};

export default function ProductionPage() {
  const { user, loading: authLoading } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    const { data } = await supabase
      .from("laser_quote")
      .select("*")
      .in("status", ["won", "completed", "ready_for_collection", "error"])
      .order("updated_at", { ascending: true });
    setQuotes((data as Quote[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user]);

  const updateStatus = async (id: number, status: string) => {
    await supabase.from("laser_quote").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    await fetchAll();
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>Production</h1>
        <AuthButton redirectTo="/laserquote/production" />
      </div>
    );
  }

  const queue = quotes.filter((q) => q.status === "won");
  const completed = quotes.filter((q) => q.status === "completed");
  const ready = quotes.filter((q) => q.status === "ready_for_collection");
  const errors = quotes.filter((q) => q.status === "error");

  const fmt = (v: number | null) => (v != null ? `£${v.toFixed(2)}` : "—");
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });

  const LASER_QUOTE_SERVICE_URL = process.env.NEXT_PUBLIC_LASER_QUOTE_SERVICE_URL ?? "";

  type ActionDef = { label: string; color: string; status: string };

  const QuoteTable = ({
    items,
    actions,
    showDocs,
  }: {
    items: Quote[];
    actions?: ActionDef[];
    showDocs?: boolean;
  }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2 pr-4 font-medium">Quote #</th>
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 font-medium">Material</th>
            <th className="py-2 pr-4 font-medium">Grade</th>
            <th className="py-2 pr-4 font-medium">Thick.</th>
            <th className="py-2 pr-4 font-medium text-right">Value</th>
            <th className="py-2 pr-4 font-medium">Date</th>
            {showDocs && <th className="py-2 pr-4 font-medium">Docs</th>}
            {actions && actions.length > 0 && <th className="py-2 font-medium"></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((q) => (
            <tr key={q.id} className="border-b last:border-0 hover:bg-gray-50">
              <td className="py-2 pr-4 font-mono font-bold">
                <a href={q.import_id ? `/laserquote/imports/${q.import_id}` : `/laserquote/quotes/${q.id}`} className="text-blue-600 hover:underline">
                  {q.quote_number}
                </a>
              </td>
              <td className="py-2 pr-4 font-medium">{q.customer}</td>
              <td className="py-2 pr-4 text-xs">{q.material ?? "—"}</td>
              <td className="py-2 pr-4 text-xs uppercase">{q.grade ?? "—"}</td>
              <td className="py-2 pr-4 text-xs">{q.thickness ? `${q.thickness}mm` : "—"}</td>
              <td className="py-2 pr-4 text-right font-mono text-xs">{fmt(q.total_value)}</td>
              <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">{fmtDate(q.created_at)}</td>
              {showDocs && (
                <td className="py-3 pr-4 whitespace-nowrap">
                  <a
                    href={`${LASER_QUOTE_SERVICE_URL}/api/laser/quotes/${q.id}/delivery-note`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    Del. Note
                  </a>
                </td>
              )}
              {actions && actions.length > 0 && (
                <td className="py-3 text-right whitespace-nowrap space-x-2">
                  {actions.map((a) => (
                    <button
                      key={a.status}
                      onClick={() => updateStatus(q.id, a.status)}
                      className="text-xs px-3 py-1 rounded text-white hover:opacity-90"
                      style={{ backgroundColor: a.color }}
                    >
                      {a.label}
                    </button>
                  ))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <PageHeader title="Production" />

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <>
          {/* Production Queue */}
          <div>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
              Production Queue
              {queue.length > 0 && <span className="text-sm font-normal text-gray-400 ml-2">({queue.length})</span>}
            </h2>
            {queue.length === 0 ? (
              <p className="text-gray-500 text-sm">No jobs in the queue.</p>
            ) : (
              <QuoteTable
                items={queue}
                actions={[
                  { label: "Complete", color: "#16a34a", status: "completed" },
                  { label: "Error", color: "#dc2626", status: "error" },
                  { label: "Cancel", color: "#6b7280", status: "cancelled" },
                ]}
              />
            )}
          </div>

          {/* Completed */}
          <div>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
              Completed
              {completed.length > 0 && <span className="text-sm font-normal text-gray-400 ml-2">({completed.length})</span>}
            </h2>
            {completed.length === 0 ? (
              <p className="text-gray-500 text-sm">No completed jobs.</p>
            ) : (
              <QuoteTable
                items={completed}
                showDocs
                actions={[
                  { label: "Ready for Collection", color: "#059669", status: "ready_for_collection" },
                ]}
              />
            )}
          </div>

          {/* Ready for Collection */}
          <div>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
              Ready for Collection
              {ready.length > 0 && <span className="text-sm font-normal text-gray-400 ml-2">({ready.length})</span>}
            </h2>
            {ready.length === 0 ? (
              <p className="text-gray-500 text-sm">No jobs ready for collection.</p>
            ) : (
              <QuoteTable
                items={ready}
                showDocs
                actions={[
                  { label: "Collected", color: "#0d9488", status: "delivered" },
                ]}
              />
            )}
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 text-red-700">
                Errors
                <span className="text-sm font-normal text-gray-400 ml-2">({errors.length})</span>
              </h2>
              <QuoteTable
                items={errors}
                actions={[
                  { label: "Return to Queue", color: "#4f46e5", status: "won" },
                  { label: "Cancel", color: "#6b7280", status: "cancelled" },
                ]}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
