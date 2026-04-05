"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";

type QuoteLine = {
  id: number;
  line_number: number;
  part_name: string;
  quantity: number;
  bounding_size: string | null;
  material: string | null;
  grade: string | null;
  thickness: number | null;
  mass_each: number | null;
  material_cost_each: number | null;
  runtime_seconds_each: number | null;
  runtime_cost: number | null;
  handling_cost: number | null;
  total_cost: number | null;
  margin: number | null;
  unit_price: number | null;
  line_price: number | null;
};

type Quote = {
  id: number;
  quote_number: number;
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
  lines: QuoteLine[];
};

const LASER_QUOTE_SERVICE_URL = process.env.NEXT_PUBLIC_LASER_QUOTE_SERVICE_URL ?? "";

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !id) return;
    (async () => {
      const { data } = await supabase
        .from("laser_quote")
        .select(`
          *,
          lines:laser_quote_line(*)
        `)
        .eq("id", id)
        .single();
      setQuote(data as Quote | null);
      setLoading(false);
    })();
  }, [user, id]);

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
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>Quote</h1>
        <AuthButton redirectTo={`/laserquote/quotes/${id}`} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-gray-400 text-sm">Loading quote...</p>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-red-600">Quote not found.</p>
      </div>
    );
  }

  const lines = (quote.lines ?? []).sort((a, b) => a.line_number - b.line_number);
  const fmt = (v: number | null) => (v != null ? `£${v.toFixed(2)}` : "—");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader title={`Quote ${quote.quote_number}`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white border border-gray-200 rounded-lg p-6">
        <div>
          <p className="text-xs text-gray-500">Customer</p>
          <p className="font-semibold">{quote.customer}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Material</p>
          <p className="font-medium">
            {quote.material ?? "—"} {quote.grade ? quote.grade : ""}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Thickness</p>
          <p className="font-medium">{quote.thickness ? `${quote.thickness}mm` : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Status</p>
          <StatusBadge status={quote.status} />
        </div>
        <div>
          <p className="text-xs text-gray-500">Incoterms</p>
          <p className="font-medium">{quote.incoterms ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Lead Time</p>
          <p className="font-medium">{quote.lead_time ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total Value</p>
          <p className="font-bold text-lg">{fmt(quote.total_value)}</p>
        </div>
        <div className="flex items-end gap-2">
          <a
            href={`${LASER_QUOTE_SERVICE_URL}/api/laser/quotes/${quote.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-4 py-2 rounded text-white hover:opacity-90"
            style={{ backgroundColor: "var(--pss-navy)" }}
          >
            Quote PDF
          </a>
          <a
            href={`${LASER_QUOTE_SERVICE_URL}/api/laser/quotes/${quote.id}/delivery-note`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            Delivery Note
          </a>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
          Line Items
        </h2>
        {lines.length === 0 ? (
          <p className="text-gray-500 text-sm">No line items.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Part</th>
                  <th className="py-2 pr-3 font-medium text-right">Qty</th>
                  <th className="py-2 pr-3 font-medium">Size</th>
                  <th className="py-2 pr-3 font-medium text-right">Mass (kg)</th>
                  <th className="py-2 pr-3 font-medium text-right">Mat. Cost</th>
                  <th className="py-2 pr-3 font-medium text-right">Runtime</th>
                  <th className="py-2 pr-3 font-medium text-right">Run Cost</th>
                  <th className="py-2 pr-3 font-medium text-right">Handling</th>
                  <th className="py-2 pr-3 font-medium text-right">Total Cost</th>
                  <th className="py-2 pr-3 font-medium text-right">Margin</th>
                  <th className="py-2 pr-3 font-medium text-right">Unit Price</th>
                  <th className="py-2 font-medium text-right">Line Price</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-3 text-gray-400">{line.line_number}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{line.part_name}</td>
                    <td className="py-2 pr-3 text-right">{line.quantity}</td>
                    <td className="py-2 pr-3 text-xs">{line.bounding_size ?? "—"}</td>
                    <td className="py-2 pr-3 text-right text-xs">
                      {line.mass_each?.toFixed(2) ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(line.material_cost_each)}</td>
                    <td className="py-2 pr-3 text-right text-xs">
                      {line.runtime_seconds_each != null ? `${Math.round(line.runtime_seconds_each)}s` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(line.runtime_cost)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(line.handling_cost)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(line.total_cost)}</td>
                    <td className="py-2 pr-3 text-right text-xs">
                      {line.margin != null ? `${(line.margin * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs font-medium">{fmt(line.unit_price)}</td>
                    <td className="py-2 text-right font-mono text-xs font-bold">{fmt(line.line_price)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td colSpan={12} className="py-2 pr-3 text-right font-semibold">Total</td>
                  <td className="py-2 text-right font-mono font-bold">{fmt(quote.total_value)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
