"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";

const ACTIVE_STATUSES = ["draft", "issued", "revised", "error", "cancelled"];

const fetchQuotes = async () => {
  const { data } = await supabase
    .from("laser_quote")
    .select("*")
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data as Quote[] | null) ?? [];
};

type Quote = {
  id: number;
  quote_number: number;
  import_id: string | null;
  customer: string;
  material: string | null;
  grade: string | null;
  thickness: number | null;
  incoterms: string | null;
  lead_time: string | null;
  status: string;
  total_value: number | null;
  pdf_path: string | null;
  created_at: string;
};

const SERVICE_PREFIX = "/laserquote/api/service";

export default function QuotesPage() {
  const { user, loading: authLoading } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerFilter, setCustomerFilter] = useState("");

  useEffect(() => {
    if (!user) return;
    fetchQuotes().then((data) => { setQuotes(data); setLoading(false); });
  }, [user]);

  const updateStatus = async (id: number, status: string) => {
    await supabase.from("laser_quote").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    setQuotes(await fetchQuotes());
  };

  const [refreshing, setRefreshing] = useState<number | null>(null);
  const handleRefresh = async (quoteId: number) => {
    setRefreshing(quoteId);
    try {
      const res = await fetch(`${SERVICE_PREFIX}/quotes/${quoteId}/refresh`, {
        method: "POST",
      });
      if (!res.ok) {
        alert("Failed to refresh quote");
      }
    } catch {
      alert("Service unavailable");
    }
    setQuotes(await fetchQuotes());
    setRefreshing(null);
  };

  const customers = [...new Set(quotes.map((q) => q.customer))].sort();
  const filtered = customerFilter
    ? quotes.filter((q) => q.customer === customerFilter)
    : quotes;

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
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>Quotes</h1>
        <AuthButton redirectTo="/laserquote/quotes" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <PageHeader title="Quotes" />
        {customers.length > 1 && (
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading quotes...</p>
      ) : quotes.length === 0 ? (
        <p className="text-gray-500">No quotes generated yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Quote #</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Material</th>
                <th className="py-2 pr-4 font-medium">Grade</th>
                <th className="py-2 pr-4 font-medium">Thick.</th>
                <th className="py-2 pr-4 font-medium">Terms</th>
                <th className="py-2 pr-4 font-medium">Lead Time</th>
                <th className="py-2 pr-4 font-medium text-right">Value</th>
                <th className="py-2 pr-4 font-medium">Docs</th>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-mono font-bold">
                    <a
                      href={q.import_id ? `/laserquote/imports/${q.import_id}` : `/laserquote/quotes/${q.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {q.quote_number}
                    </a>
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="py-2 pr-4 font-medium">{q.customer}</td>
                  <td className="py-2 pr-4 text-xs">{q.material ?? "—"}</td>
                  <td className="py-2 pr-4 text-xs uppercase">{q.grade ?? "—"}</td>
                  <td className="py-2 pr-4 text-xs">{q.thickness ? `${q.thickness}mm` : "—"}</td>
                  <td className="py-2 pr-4 text-xs">{q.incoterms ?? "—"}</td>
                  <td className="py-2 pr-4 text-xs">{q.lead_time ?? "—"}</td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">
                    {q.total_value != null ? `£${q.total_value.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap space-x-2">
                    <a
                      href={`${SERVICE_PREFIX}/quotes/${q.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-2 py-1 rounded text-white hover:opacity-90"
                      style={{ backgroundColor: "var(--pss-navy)" }}
                    >
                      Quote
                    </a>
                    <a
                      href={`${SERVICE_PREFIX}/quotes/${q.id}/delivery-note`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                    >
                      Del. Note
                    </a>
                  </td>
                  <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(q.created_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap space-x-2">
                    {q.status === "draft" && (
                      <button
                        onClick={() => handleRefresh(q.id)}
                        disabled={refreshing === q.id}
                        className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        {refreshing === q.id ? "..." : "Refresh"}
                      </button>
                    )}
                    {(q.status === "draft" || q.status === "error" || q.status === "cancelled") && (
                      <button
                        onClick={() => updateStatus(q.id, "won")}
                        className="text-xs px-3 py-1 rounded text-white hover:opacity-90 bg-indigo-600"
                      >
                        Add to Production
                      </button>
                    )}
                    {(q.status === "draft" || q.status === "issued" || q.status === "error" || q.status === "cancelled") && (
                      <button
                        onClick={() => updateStatus(q.id, "lost")}
                        className="text-xs px-3 py-1 rounded border border-orange-300 text-orange-700 hover:bg-orange-50"
                      >
                        Lost
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
