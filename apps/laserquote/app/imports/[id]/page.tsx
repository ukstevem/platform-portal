"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";

type Part = {
  id: number;
  part_name: string;
  nest_id: number | null;
  bounding_x: number | null;
  bounding_y: number | null;
  quantity: number;
  area: number | null;
  area_incl_holes: number | null;
  cutting_length: number | null;
  runtime_seconds: number | null;
  weight: number | null;
};

type Program = {
  id: number;
  program_name: string;
  nesting_name: string | null;
  material_code: string | null;
  thickness: number | null;
  strategy: string | null;
  sheet_count: number;
  run_count: number;
  sheet_x: number | null;
  sheet_y: number | null;
  runtime_seconds: number | null;
  utilisation: number | null;
  file_name: string | null;
  parts: Part[];
};

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
  status: string;
  total_value: number | null;
  lines: QuoteLine[];
};

type Import = {
  id: string;
  status: string;
  error_message: string | null;
  file_count: number;
  customer: string | null;
  material: string | null;
  grade: string | null;
  sheet_price: number | null;
  material_rate: number | null;
  premium: boolean;
  rem_charge: boolean;
  created_at: string;
};

export default function ImportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [imp, setImp] = useState<Import | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProgs, setExpandedProgs] = useState<Set<number>>(new Set());
  const [savingRunCount, setSavingRunCount] = useState<number | null>(null);

  const SERVICE_PREFIX = "/laserquote/api/service";

  const updateRunCount = async (programId: number, runCount: number) => {
    if (runCount < 1) return;
    setSavingRunCount(programId);
    const { error } = await supabase
      .from("laser_program")
      .update({ run_count: runCount })
      .eq("id", programId);
    if (error) {
      alert("Failed to update run count");
    }
    setSavingRunCount(null);
  };

  useEffect(() => {
    if (!user || !id) return;
    (async () => {
      const [impRes, progRes, quoteRes] = await Promise.all([
        supabase.from("laser_import").select("*").eq("id", id).single(),
        supabase
          .from("laser_program")
          .select("*, parts:laser_part(*)")
          .eq("import_id", id)
          .order("id"),
        supabase
          .from("laser_quote")
          .select("id, quote_number, status, total_value, lines:laser_quote_line(*)")
          .eq("import_id", id)
          .order("created_at", { ascending: false }),
      ]);
      setImp(impRes.data as Import | null);
      setPrograms((progRes.data as Program[] | null) ?? []);
      setQuotes((quoteRes.data as Quote[] | null) ?? []);
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
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>Import Detail</h1>
        <AuthButton redirectTo={`/laserquote/imports/${id}`} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-gray-400 text-sm">Loading import...</p>
      </div>
    );
  }

  if (!imp) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-red-600">Import not found.</p>
      </div>
    );
  }

  const fmt = (v: number | null) => (v != null ? `£${v.toFixed(2)}` : "—");
  const totalParts = programs.reduce((sum, p) => sum + (p.parts?.length ?? 0), 0);
  const totalSheets = programs.reduce((sum, p) => sum + p.sheet_count, 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader title={`Import: ${imp.customer ?? "—"}`} />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white border border-gray-200 rounded-lg p-6">
        <div>
          <p className="text-xs text-gray-500">Status</p>
          <StatusBadge status={imp.status} error={imp.error_message} />
        </div>
        <div>
          <p className="text-xs text-gray-500">Material</p>
          <p className="font-medium">{imp.material ?? "—"} {imp.grade ?? ""}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Programs / Sheets</p>
          <p className="font-medium">{programs.length} programs, {totalSheets} sheets</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total Parts</p>
          <p className="font-medium">{totalParts}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Premium</p>
          <p className="font-medium">{imp.premium ? "Yes" : "No"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Sheet Price</p>
          <p className="font-medium">{imp.sheet_price != null ? fmt(imp.sheet_price) : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Material Rate</p>
          <p className="font-medium">{imp.material_rate != null ? `£${imp.material_rate}/T` : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Uploaded</p>
          <p className="font-medium text-sm">
            {new Date(imp.created_at).toLocaleString("en-GB", {
              day: "2-digit", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
          </p>
        </div>
      </div>

      {/* Programs */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
          Programs
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Program</th>
                <th className="py-2 pr-4 font-medium">Material</th>
                <th className="py-2 pr-4 font-medium">Thick.</th>
                <th className="py-2 pr-4 font-medium">Strategy</th>
                <th className="py-2 pr-4 font-medium">Sheets</th>
                <th className="py-2 pr-4 font-medium">Runs</th>
                <th className="py-2 pr-4 font-medium">Sheet Size</th>
                <th className="py-2 pr-4 font-medium">Runtime</th>
                <th className="py-2 pr-4 font-medium">Util.</th>
                <th className="py-2 font-medium">Parts</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((prog) => {
                const formatTime = (secs: number | null) => {
                  if (!secs) return "—";
                  const h = Math.floor(secs / 3600);
                  const m = Math.floor((secs % 3600) / 60);
                  const s = secs % 60;
                  if (h > 0) return `${h}h ${m}m ${s}s`;
                  if (m > 0) return `${m}m ${s}s`;
                  return `${s}s`;
                };
                return (
                  <React.Fragment key={prog.id}>
                    <tr
                      className="border-b hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedProgs((prev) => {
                      const next = new Set(prev);
                      if (next.has(prog.id)) next.delete(prog.id);
                      else next.add(prog.id);
                      return next;
                    })}
                    >
                      <td className="py-2 pr-4 font-mono text-xs font-bold">{prog.program_name}</td>
                      <td className="py-2 pr-4 text-xs">{prog.material_code ?? "—"}</td>
                      <td className="py-2 pr-4 text-xs">{prog.thickness ? `${prog.thickness}mm` : "—"}</td>
                      <td className="py-2 pr-4 text-xs">{prog.strategy ?? "—"}</td>
                      <td className="py-2 pr-4 text-center">{prog.sheet_count}</td>
                      <td className="py-2 pr-4 text-center">
                        <input
                          type="number"
                          min={1}
                          value={prog.run_count}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val) && val >= 1) {
                              setPrograms((prev) =>
                                prev.map((p) => (p.id === prog.id ? { ...p, run_count: val } : p))
                              );
                            }
                          }}
                          onBlur={() => updateRunCount(prog.id, prog.run_count)}
                          disabled={savingRunCount === prog.id}
                          className="w-14 text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {prog.sheet_x && prog.sheet_y ? `${prog.sheet_x} x ${prog.sheet_y}` : "—"}
                      </td>
                      <td className="py-2 pr-4 text-xs">{formatTime(prog.runtime_seconds)}</td>
                      <td className="py-2 pr-4 text-xs">{prog.utilisation != null ? `${prog.utilisation}%` : "—"}</td>
                      <td className="py-2 text-center">{prog.parts?.length ?? 0}</td>
                    </tr>
                    {expandedProgs.has(prog.id) && prog.parts?.length > 0 && (
                      <tr>
                        <td colSpan={10} className="bg-gray-50 px-6 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400">
                                <th className="py-1 pr-2">ID</th>
                                <th className="py-1 pr-2">Part Name</th>
                                <th className="py-1 pr-2 text-right">Qty</th>
                                <th className="py-1 pr-2 text-right">Bounding</th>
                                <th className="py-1 pr-2 text-right">Area</th>
                                <th className="py-1 pr-2 text-right">Cut Length</th>
                                <th className="py-1 pr-2 text-right">Runtime</th>
                                <th className="py-1 text-right">Weight</th>
                              </tr>
                            </thead>
                            <tbody>
                              {prog.parts.map((part) => (
                                <tr key={part.id} className="border-t border-gray-200">
                                  <td className="py-1 pr-2 text-gray-400">{part.nest_id ?? "—"}</td>
                                  <td className="py-1 pr-2 font-mono">{part.part_name}</td>
                                  <td className="py-1 pr-2 text-right">{part.quantity}</td>
                                  <td className="py-1 pr-2 text-right">
                                    {part.bounding_x && part.bounding_y ? `${part.bounding_x} x ${part.bounding_y}` : "—"}
                                  </td>
                                  <td className="py-1 pr-2 text-right">{part.area != null ? `${part.area} mm²` : "—"}</td>
                                  <td className="py-1 pr-2 text-right">{part.cutting_length != null ? `${part.cutting_length} mm` : "—"}</td>
                                  <td className="py-1 pr-2 text-right">{part.runtime_seconds != null ? `${part.runtime_seconds}s` : "—"}</td>
                                  <td className="py-1 text-right">{part.weight != null ? `${part.weight} kg` : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quotes */}
      {quotes.map((quote) => {
        const lines = (quote.lines ?? []).sort((a, b) => a.line_number - b.line_number);
        return (
          <div key={quote.id}>
            <div className="flex items-center gap-4 mb-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--pss-navy)" }}>
                Quote {quote.quote_number}
              </h2>
              <StatusBadge status={quote.status} />
              {quote.total_value != null && (
                <span className="font-mono font-bold text-lg">{fmt(quote.total_value)}</span>
              )}
              {quote.status === "draft" && (
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`${SERVICE_PREFIX}/quotes/${quote.id}/refresh`, {
                        method: "POST",
                      });
                      if (res.ok) {
                        // Reload quote data
                        const quoteRes = await supabase
                          .from("laser_quote")
                          .select("id, quote_number, status, total_value, lines:laser_quote_line(*)")
                          .eq("import_id", id)
                          .order("created_at", { ascending: false });
                        setQuotes((quoteRes.data as Quote[] | null) ?? []);
                      } else {
                        alert("Failed to refresh quote");
                      }
                    } catch {
                      alert("Service unavailable");
                    }
                  }}
                  className="text-sm px-4 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                >
                  Refresh Quote
                </button>
              )}
              <a
                href={`${SERVICE_PREFIX}/quotes/${quote.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm px-4 py-1.5 rounded text-white hover:opacity-90 ml-auto"
                style={{ backgroundColor: "var(--pss-navy)" }}
              >
                Download PDF
              </a>
            </div>
            {lines.length > 0 && (
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
                        <td className="py-2 pr-3 text-right text-xs">{line.mass_each?.toFixed(2) ?? "—"}</td>
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
        );
      })}

      {quotes.length === 0 && (
        <p className="text-gray-500 text-sm">No quotes generated for this import yet.</p>
      )}
    </div>
  );
}
