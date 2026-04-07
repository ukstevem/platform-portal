"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";

type ProgramRun = {
  id: number;
  program_id: number;
  run_number: number;
  status: string;
  material_trace: string | null;
};

type Program = {
  id: number;
  program_name: string;
  material_code: string | null;
  thickness: number | null;
  sheet_count: number;
  run_count: number;
  sheet_x: number | null;
  sheet_y: number | null;
  runtime_seconds: number | null;
  utilisation: number | null;
};

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
  material_trace: string | null;
  created_at: string;
  updated_at: string;
  programs: Program[];
  runs: ProgramRun[];
};

const SERVICE_PREFIX = "/laserquote/api/service";

export default function ProductionPage() {
  const { user, loading: authLoading } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedQuotes, setExpandedQuotes] = useState<Set<number>>(new Set());

  const fetchAll = async () => {
    const { data } = await supabase
      .from("laser_quote")
      .select(`
        *,
        import:laser_import!import_id(
          programs:laser_program(
            id, program_name, material_code, thickness,
            sheet_count, run_count, sheet_x, sheet_y,
            runtime_seconds, utilisation
          )
        ),
        runs:laser_program_run(*)
      `)
      .in("status", ["won", "completed", "ready_for_collection", "error"])
      .order("updated_at", { ascending: true });

    const mapped = ((data as unknown[]) ?? []).map((raw: unknown) => {
      const q = raw as Quote & { import: { programs: Program[] } | null };
      return {
        ...q,
        programs: q.import?.programs ?? [],
      };
    });

    // Ensure runs exist for each quote's programs
    for (const q of mapped) {
      await ensureRuns(q.id, q.programs);
    }

    // Re-fetch runs after ensuring they exist
    const { data: allRuns } = await supabase
      .from("laser_program_run")
      .select("*")
      .in("quote_id", mapped.map((q) => q.id));

    for (const q of mapped) {
      q.runs = (allRuns ?? []).filter((r: ProgramRun) => r.quote_id === q.id);
    }

    setQuotes(mapped);
    setLoading(false);
  };

  const ensureRuns = async (quoteId: number, programs: Program[]) => {
    const { data: existing } = await supabase
      .from("laser_program_run")
      .select("program_id, run_number")
      .eq("quote_id", quoteId);

    const existingSet = new Set(
      (existing ?? []).map((r: { program_id: number; run_number: number }) => `${r.program_id}-${r.run_number}`)
    );

    const toInsert: { quote_id: number; program_id: number; run_number: number }[] = [];
    for (const prog of programs) {
      for (let r = 1; r <= prog.run_count; r++) {
        if (!existingSet.has(`${prog.id}-${r}`)) {
          toInsert.push({ quote_id: quoteId, program_id: prog.id, run_number: r });
        }
      }
    }

    if (toInsert.length > 0) {
      await supabase.from("laser_program_run").insert(toInsert);
    }
  };

  const updateRunStatus = async (runId: number, status: string) => {
    await supabase
      .from("laser_program_run")
      .update({
        status,
        completed_at: status === "complete" ? new Date().toISOString() : null,
      })
      .eq("id", runId);
    await fetchAll();
  };

  const updateQuoteStatus = async (id: number, status: string) => {
    await supabase.from("laser_quote").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    await fetchAll();
  };

  useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user]);

  const toggleQuote = (id: number) => {
    setExpandedQuotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const formatTime = (secs: number | null) => {
    if (!secs) return "—";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const RUN_STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    complete: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-500",
  };

  type ActionDef = { label: string; color: string; status: string };

  const QuoteSection = ({
    items,
    quoteActions,
    showDocs,
    showTrace,
  }: {
    items: Quote[];
    quoteActions?: ActionDef[];
    showDocs?: boolean;
    showTrace?: boolean;
  }) => (
    <div className="space-y-2">
      {items.map((q) => {
        const runs = q.runs ?? [];
        const totalRuns = runs.length;
        const completedRuns = runs.filter((r) => r.status === "complete").length;
        const allComplete = totalRuns > 0 && completedRuns === totalRuns;

        return (
          <div key={q.id} className="border border-gray-200 rounded-lg bg-white">
            {/* Quote header */}
            <div
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50"
              onClick={() => toggleQuote(q.id)}
            >
              <span className="text-xs text-gray-400">{expandedQuotes.has(q.id) ? "▼" : "▶"}</span>
              <a
                href={q.import_id ? `/laserquote/imports/${q.import_id}` : `/laserquote/quotes/${q.id}`}
                className="font-mono font-bold text-blue-600 hover:underline text-sm"
                onClick={(e) => e.stopPropagation()}
              >
                {q.quote_number}
              </a>
              <span className="font-medium text-sm">{q.customer}</span>
              <span className="text-xs text-gray-500">{q.material ?? ""} {q.grade ?? ""} {q.thickness ? `${q.thickness}mm` : ""}</span>
              <span className="font-mono text-xs">{fmt(q.total_value)}</span>
              <span className="text-xs text-gray-400">
                {completedRuns}/{totalRuns} runs
              </span>

              {showTrace && (
                <input
                  type="text"
                  defaultValue={q.material_trace ?? ""}
                  placeholder="Cert/heat no."
                  onClick={(e) => e.stopPropagation()}
                  onBlur={async (e) => {
                    const val = e.target.value.trim();
                    if (val !== (q.material_trace ?? "")) {
                      await supabase
                        .from("laser_quote")
                        .update({ material_trace: val || null })
                        .eq("id", q.id);
                      await fetchAll();
                    }
                  }}
                  className="w-36 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              )}
              {!showTrace && q.material_trace && (
                <span className="text-xs text-gray-400">{q.material_trace}</span>
              )}

              {showDocs && (
                <a
                  href={`${SERVICE_PREFIX}/quotes/${q.id}/delivery-note`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  Del. Note
                </a>
              )}

              <div className="ml-auto whitespace-nowrap space-x-2">
                {quoteActions?.map((a) => (
                  <button
                    key={a.status}
                    onClick={(e) => { e.stopPropagation(); updateQuoteStatus(q.id, a.status); }}
                    className={`text-xs px-3 py-1 rounded text-white hover:opacity-90 ${a.status === "completed" && !allComplete ? "opacity-40 cursor-not-allowed" : ""}`}
                    disabled={a.status === "completed" && !allComplete}
                    style={{ backgroundColor: a.color }}
                    title={a.status === "completed" && !allComplete ? "Complete all program runs first" : ""}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Expanded: program runs */}
            {expandedQuotes.has(q.id) && q.programs?.length > 0 && (
              <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-gray-400">
                      <th className="py-1 pr-3">Program</th>
                      <th className="py-1 pr-3 text-center">Run</th>
                      <th className="py-1 pr-3">Sheet Size</th>
                      <th className="py-1 pr-3 text-center">Sheets</th>
                      <th className="py-1 pr-3">Runtime</th>
                      <th className="py-1 pr-3">Status</th>
                      <th className="py-1 pr-3">Trace</th>
                      <th className="py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.programs.flatMap((prog) => {
                      const progRuns = runs
                        .filter((r) => r.program_id === prog.id)
                        .sort((a, b) => a.run_number - b.run_number);

                      return progRuns.map((run, idx) => (
                        <tr key={run.id} className={`border-t border-gray-200 ${run.status === "complete" ? "bg-green-50/50" : run.status === "error" ? "bg-red-50/50" : ""}`}>
                          <td className="py-1.5 pr-3 font-mono font-bold">
                            {idx === 0 ? prog.program_name : ""}
                          </td>
                          <td className="py-1.5 pr-3 text-center font-medium">
                            {run.run_number} / {prog.run_count}
                          </td>
                          <td className="py-1.5 pr-3">
                            {prog.sheet_x && prog.sheet_y ? `${prog.sheet_x} x ${prog.sheet_y}` : "—"}
                          </td>
                          <td className="py-1.5 pr-3 text-center">{prog.sheet_count}</td>
                          <td className="py-1.5 pr-3">{formatTime(prog.runtime_seconds)}</td>
                          <td className="py-1.5 pr-3">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${RUN_STATUS_COLORS[run.status] ?? "bg-gray-100 text-gray-700"}`}>
                              {run.status}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3">
                            <input
                              type="text"
                              defaultValue={run.material_trace ?? ""}
                              placeholder="Cert/heat"
                              onBlur={async (e) => {
                                const val = e.target.value.trim();
                                if (val !== (run.material_trace ?? "")) {
                                  await supabase
                                    .from("laser_program_run")
                                    .update({ material_trace: val || null })
                                    .eq("id", run.id);
                                }
                              }}
                              className="w-28 border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap space-x-1">
                            {run.status === "pending" && (
                              <>
                                <button
                                  onClick={() => updateRunStatus(run.id, "complete")}
                                  className="text-xs px-2 py-0.5 rounded text-white hover:opacity-90"
                                  style={{ backgroundColor: "#16a34a" }}
                                >
                                  Complete
                                </button>
                                <button
                                  onClick={() => updateRunStatus(run.id, "error")}
                                  className="text-xs px-2 py-0.5 rounded text-white hover:opacity-90"
                                  style={{ backgroundColor: "#dc2626" }}
                                >
                                  Error
                                </button>
                              </>
                            )}
                            {run.status === "error" && (
                              <button
                                onClick={() => updateRunStatus(run.id, "pending")}
                                className="text-xs px-2 py-0.5 rounded text-white hover:opacity-90"
                                style={{ backgroundColor: "#4f46e5" }}
                              >
                                Retry
                              </button>
                            )}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
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
              <QuoteSection
                items={queue}
                showTrace
                quoteActions={[
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
              <QuoteSection
                items={completed}
                showTrace
                showDocs
                quoteActions={[
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
              <QuoteSection
                items={ready}
                showTrace
                showDocs
                quoteActions={[
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
              <QuoteSection
                items={errors}
                quoteActions={[
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
