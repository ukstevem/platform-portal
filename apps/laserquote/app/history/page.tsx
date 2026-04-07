"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";

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
  created_at: string;
  updated_at: string;
};

const HISTORY_STATUSES = ["delivered", "lost", "cancelled"];
const SERVICE_PREFIX = "/laserquote/api/service";

export default function HistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("laser_quote")
        .select("*")
        .in("status", HISTORY_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(500);
      setQuotes((data as Quote[] | null) ?? []);
      setLoading(false);
    })();
  }, [user]);

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
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>History</h1>
        <AuthButton redirectTo="/laserquote/history" />
      </div>
    );
  }

  const customers = [...new Set(quotes.map((q) => q.customer))].sort();
  const filtered = quotes.filter((q) => {
    if (customerFilter && q.customer !== customerFilter) return false;
    if (statusFilter && q.status !== statusFilter) return false;
    return true;
  });

  const fmt = (v: number | null) => (v != null ? `£${v.toFixed(2)}` : "—");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <PageHeader title="History" />
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          <option value="">All outcomes</option>
          <option value="delivered">Delivered</option>
          <option value="lost">Lost</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span className="text-sm text-gray-400">{filtered.length} records</span>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading history...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">No history yet.</p>
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
                <th className="py-2 pr-4 font-medium text-right">Value</th>
                <th className="py-2 pr-4 font-medium">Docs</th>
                <th className="py-2 pr-4 font-medium">Quoted</th>
                <th className="py-2 font-medium">Closed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-mono font-bold">
                    <a href={q.import_id ? `/laserquote/imports/${q.import_id}` : `/laserquote/quotes/${q.id}`} className="text-blue-600 hover:underline">
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
                  <td className="py-2 pr-4 text-right font-mono text-xs">{fmt(q.total_value)}</td>
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
                    {q.status === "delivered" && (
                      <a
                        href={`${SERVICE_PREFIX}/quotes/${q.id}/delivery-note`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Del. Note
                      </a>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(q.created_at).toLocaleDateString("en-GB", {
                      day: "2-digit", month: "short", year: "2-digit",
                    })}
                  </td>
                  <td className="py-2 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(q.updated_at).toLocaleDateString("en-GB", {
                      day: "2-digit", month: "short", year: "2-digit",
                    })}
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
