"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { PageHeader } from "@platform/ui";
import { CuttingListView } from "./CuttingListView";
import type { CuttingList } from "./CuttingListView";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CutRow = { id: number; length: string; qty: string };
type StockRow = { id: number; length: string; qty: string };

type SectionBlock = {
  id: number;
  section: string;
  cuts: CutRow[];
  stock: StockRow[];
};

type Progress = {
  phase?: number;
  description?: string;
  percent?: number;
  section?: string;
  section_index?: number;
  section_count?: number;
};

/* CutEntry, Bar, SectionResult, CuttingList types imported from CuttingListView */

type ProjectOption = { projectnumber: string; description: string };

export type NestingPageProps = {
  /** Pre-populate form from a saved job (rerun from history) */
  initialPayload?: {
    job_label?: string;
    sections: SectionBlock[];
    kerf?: string;
  };
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let _nextId = 1;
function nextId() {
  return _nextId++;
}

function emptyCut(): CutRow {
  return { id: nextId(), length: "", qty: "1" };
}

function emptyStock(): StockRow {
  return { id: nextId(), length: "6000", qty: "10" };
}

function emptySection(): SectionBlock {
  return {
    id: nextId(),
    section: "",
    cuts: [emptyCut()],
    stock: [emptyStock()],
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NestingPage({ initialPayload }: NestingPageProps = {}) {
  const { user } = useAuth();

  /* form state */
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [jobLabel, setJobLabel] = useState(initialPayload?.job_label ?? "");
  const [sections, setSections] = useState<SectionBlock[]>(
    initialPayload?.sections?.length ? initialPayload.sections : [emptySection()]
  );
  const [kerf, setKerf] = useState(initialPayload?.kerf ?? "3");

  /* job state */
  const [taskId, setTaskId] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "submitting" | "running" | "completed" | "failed"
  >("idle");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<CuttingList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPayloadRef = useRef<object | null>(null);

  /* ---- load project numbers from Supabase ---- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("project_register_items")
        .select("projectnumber, item_seq, line_desc")
        .order("projectnumber")
        .order("item_seq");

      if (!data) return;

      const map = new Map<string, string>();
      for (const r of data) {
        if (!map.has(r.projectnumber)) {
          map.set(r.projectnumber, r.line_desc ?? "");
        }
      }

      setProjects(
        Array.from(map.entries())
          .map(([projectnumber, description]) => ({
            projectnumber,
            description,
          }))
          .sort(
            (a, b) =>
              (parseInt(b.projectnumber) || 0) -
              (parseInt(a.projectnumber) || 0)
          )
      );
    })();
  }, []);

  /* ---- polling for nesting job status ---- */
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return stopPolling;
  }, [stopPolling]);

  const startPolling = useCallback(
    (tid: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/nesting/api/nesting/status/${tid}`);
          const data = await res.json();

          if (data.progress) setProgress(data.progress);

          if (data.status === "completed") {
            stopPolling();
            setPhase("completed");
            const clRes = await fetch(
              `/nesting/api/nesting/cutting-list/${tid}`
            );
            if (clRes.ok) {
              const cuttingList = await clRes.json();
              setResult(cuttingList);

              /* update job row with results */
              supabase
                .from("nesting_jobs")
                .update({
                  status: "completed",
                  result_summary: cuttingList.totals ?? null,
                })
                .eq("task_id", tid)
                .then(({ error: dbErr }) => {
                  if (dbErr) console.error("Failed to update nesting job:", dbErr);
                });
            }
          } else if (data.status === "failed") {
            stopPolling();
            setPhase("failed");
            setError(data.error ?? "Nesting job failed");

            supabase
              .from("nesting_jobs")
              .update({ status: "failed" })
              .eq("task_id", tid)
              .then(({ error: dbErr }) => {
                if (dbErr) console.error("Failed to update nesting job:", dbErr);
              });
          }
        } catch {
          /* ignore transient fetch errors during polling */
        }
      }, 1500);
    },
    [stopPolling, jobLabel, user]
  );

  /* ---- section / row mutators ---- */
  function updateSection(
    secId: number,
    field: "section",
    value: string
  ) {
    setSections((prev) =>
      prev.map((s) => (s.id === secId ? { ...s, [field]: value } : s))
    );
  }

  function removeSection(secId: number) {
    setSections((prev) => {
      const next = prev.filter((s) => s.id !== secId);
      return next.length ? next : [emptySection()];
    });
  }

  function updateCut(
    secId: number,
    cutId: number,
    field: keyof CutRow,
    value: string
  ) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === secId
          ? {
              ...s,
              cuts: s.cuts.map((c) =>
                c.id === cutId ? { ...c, [field]: value } : c
              ),
            }
          : s
      )
    );
  }

  function addCut(secId: number) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === secId ? { ...s, cuts: [...s.cuts, emptyCut()] } : s
      )
    );
  }

  function removeCut(secId: number, cutId: number) {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== secId) return s;
        const next = s.cuts.filter((c) => c.id !== cutId);
        return { ...s, cuts: next.length ? next : [emptyCut()] };
      })
    );
  }

  function updateStockRow(
    secId: number,
    stockId: number,
    field: keyof StockRow,
    value: string
  ) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === secId
          ? {
              ...s,
              stock: s.stock.map((st) =>
                st.id === stockId ? { ...st, [field]: value } : st
              ),
            }
          : s
      )
    );
  }

  function addStockRow(secId: number) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === secId
          ? { ...s, stock: [...s.stock, emptyStock()] }
          : s
      )
    );
  }

  function removeStockRow(secId: number, stockId: number) {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== secId) return s;
        const next = s.stock.filter((st) => st.id !== stockId);
        return { ...s, stock: next.length ? next : [emptyStock()] };
      })
    );
  }

  /* ---- submit ---- */
  async function handleSubmit() {
    setError(null);
    setResult(null);
    setProgress(null);

    /* validate: at least one section with a name, one cut, one stock */
    const validSections = sections.filter((s) => {
      if (!s.section.trim()) return false;
      const hasCut = s.cuts.some(
        (c) => parseInt(c.length) > 0 && parseInt(c.qty) > 0
      );
      const hasStock = s.stock.some(
        (st) => parseInt(st.length) > 0 && parseInt(st.qty) > 0
      );
      return hasCut && hasStock;
    });

    if (validSections.length === 0) {
      setError(
        "Add at least one section with a designation, cut lengths, and stock bar lengths."
      );
      return;
    }

    /* build nesting request */
    let idx = 0;
    const nestingItems = validSections.flatMap((sec) =>
      sec.cuts
        .filter((c) => parseInt(c.length) > 0 && parseInt(c.qty) > 0)
        .flatMap((c) => {
          const qty = parseInt(c.qty);
          const len = parseInt(c.length);
          return Array.from({ length: qty }, () => ({
            item_index: idx++,
            section: sec.section.trim(),
            length: len,
          }));
        })
    );

    const stockPerSection = validSections.map((sec) => ({
      section: sec.section.trim(),
      stock: sec.stock
        .filter((st) => parseInt(st.length) > 0 && parseInt(st.qty) > 0)
        .map((st) => ({
          length: parseInt(st.length),
          qty: parseInt(st.qty),
        })),
    }));

    const body = {
      job_label: jobLabel || undefined,
      items: nestingItems,
      stock_per_section: stockPerSection,
      kerf: parseInt(kerf) || 3,
      time_limit: 300,
    };

    /* store payload so we can persist it to history on completion */
    lastPayloadRef.current = {
      job_label: jobLabel || undefined,
      sections: sections.map((s) => ({
        section: s.section,
        cuts: s.cuts.map((c) => ({ length: c.length, qty: c.qty })),
        stock: s.stock.map((st) => ({ length: st.length, qty: st.qty })),
      })),
      kerf,
    };

    setPhase("submitting");

    try {
      const res = await fetch("/nesting/api/nesting/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `Service returned ${res.status}`);
      }

      const data = await res.json();
      setTaskId(data.task_id);
      setPhase("running");

      /* persist job immediately so it survives navigation */
      supabase
        .from("nesting_jobs")
        .insert({
          project_number: jobLabel || null,
          task_id: data.task_id,
          status: "running",
          request_payload: lastPayloadRef.current,
          created_by: user?.id ?? null,
        })
        .then(({ error: dbErr }) => {
          if (dbErr) console.error("Failed to save nesting job:", dbErr);
        });

      startPolling(data.task_id);
    } catch (err: unknown) {
      setPhase("failed");
      setError(
        err instanceof Error ? err.message : "Failed to start nesting job"
      );
    }
  }

  /* ---- cancel running job ---- */
  function handleCancel() {
    stopPolling();
    setTaskId(null);
    setPhase("idle");
    setProgress(null);
    setError(null);
  }

  /* ---- reset ---- */
  function handleReset() {
    stopPolling();
    setTaskId(null);
    setPhase("idle");
    setProgress(null);
    setResult(null);
    setError(null);
    setSections([emptySection()]);
    setJobLabel("");
    setKerf("3");
  }

  const isRunning = phase === "submitting" || phase === "running";

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="Beam Nesting" />

      {/* ---- Error banner ---- */}
      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* ---- Form ---- */}
      <div className="space-y-6">
        {/* Project + Kerf row */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Number
            </label>
            <select
              value={jobLabel}
              onChange={(e) => setJobLabel(e.target.value)}
              disabled={isRunning}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">-- Select project --</option>
              {projects.map((p) => (
                <option key={p.projectnumber} value={p.projectnumber}>
                  {p.projectnumber} — {p.description}
                </option>
              ))}
            </select>
          </div>

          <div className="w-28">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Kerf (mm)
            </label>
            <input
              type="number"
              value={kerf}
              onChange={(e) => setKerf(e.target.value)}
              disabled={isRunning}
              min={0}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Section blocks */}
        {sections.map((sec, secIdx) => (
          <div key={sec.id} className="border rounded">
            {/* section header */}
            <div className="bg-gray-50 px-4 py-3 flex items-center gap-3">
              <span
                className="text-sm font-semibold shrink-0"
                style={{ color: "var(--pss-navy)" }}
              >
                Section {secIdx + 1}
              </span>
              <input
                type="text"
                placeholder="e.g. UB254x102x25"
                value={sec.section}
                onChange={(e) =>
                  updateSection(sec.id, "section", e.target.value)
                }
                disabled={isRunning}
                className="flex-1 border rounded px-3 py-1.5 text-sm"
              />
              {sections.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSection(sec.id)}
                  disabled={isRunning}
                  className="text-red-500 hover:text-red-700 text-xs cursor-pointer shrink-0"
                  title="Remove section"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="p-4 grid md:grid-cols-2 gap-4">
              {/* cuts to make */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Cuts Required
                </h3>
                <table className="border-collapse text-sm w-full">
                  <thead>
                    <tr className="text-gray-500 text-xs">
                      <th className="text-left pb-1">Length (mm)</th>
                      <th className="text-left pb-1 w-20">Qty</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {sec.cuts.map((cut) => (
                      <tr key={cut.id}>
                        <td className="pr-1 py-0.5">
                          <input
                            type="number"
                            placeholder="5000"
                            value={cut.length}
                            onChange={(e) =>
                              updateCut(
                                sec.id,
                                cut.id,
                                "length",
                                e.target.value
                              )
                            }
                            disabled={isRunning}
                            min={1}
                            className="w-full border rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="pr-1 py-0.5">
                          <input
                            type="number"
                            value={cut.qty}
                            onChange={(e) =>
                              updateCut(
                                sec.id,
                                cut.id,
                                "qty",
                                e.target.value
                              )
                            }
                            disabled={isRunning}
                            min={1}
                            className="w-full border rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="py-0.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeCut(sec.id, cut.id)}
                            disabled={isRunning}
                            className="text-red-400 hover:text-red-600 text-xs cursor-pointer"
                          >
                            &times;
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  onClick={() => addCut(sec.id)}
                  disabled={isRunning}
                  className="mt-1 text-xs text-blue-600 hover:underline cursor-pointer"
                >
                  + Add cut
                </button>
              </div>

              {/* available stock */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Available Stock
                </h3>
                <table className="border-collapse text-sm w-full">
                  <thead>
                    <tr className="text-gray-500 text-xs">
                      <th className="text-left pb-1">Bar Length (mm)</th>
                      <th className="text-left pb-1 w-20">Qty</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {sec.stock.map((st) => (
                      <tr key={st.id}>
                        <td className="pr-1 py-0.5">
                          <input
                            type="number"
                            placeholder="6000"
                            value={st.length}
                            onChange={(e) =>
                              updateStockRow(
                                sec.id,
                                st.id,
                                "length",
                                e.target.value
                              )
                            }
                            disabled={isRunning}
                            min={1}
                            className="w-full border rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="pr-1 py-0.5">
                          <input
                            type="number"
                            value={st.qty}
                            onChange={(e) =>
                              updateStockRow(
                                sec.id,
                                st.id,
                                "qty",
                                e.target.value
                              )
                            }
                            disabled={isRunning}
                            min={1}
                            className="w-full border rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="py-0.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeStockRow(sec.id, st.id)}
                            disabled={isRunning}
                            className="text-red-400 hover:text-red-600 text-xs cursor-pointer"
                          >
                            &times;
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  onClick={() => addStockRow(sec.id)}
                  disabled={isRunning}
                  className="mt-1 text-xs text-blue-600 hover:underline cursor-pointer"
                >
                  + Add stock length
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Add section button */}
        <button
          type="button"
          onClick={() =>
            setSections((prev) => [...prev, emptySection()])
          }
          disabled={isRunning}
          className="text-sm font-medium cursor-pointer hover:underline"
          style={{ color: "var(--pss-navy)" }}
        >
          + Add Section
        </button>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isRunning}
            className="px-5 py-2 rounded text-sm font-medium text-white cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: "var(--pss-navy)" }}
          >
            {phase === "submitting"
              ? "Submitting..."
              : phase === "running"
                ? "Running..."
                : "Run Nesting"}
          </button>

          {isRunning && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-5 py-2 rounded text-sm font-medium border border-red-300 text-red-600 cursor-pointer hover:bg-red-50"
            >
              Cancel
            </button>
          )}

          {(phase === "completed" || phase === "failed") && (
            <button
              type="button"
              onClick={handleReset}
              className="px-5 py-2 rounded text-sm font-medium border cursor-pointer hover:bg-gray-50"
            >
              New Job
            </button>
          )}
        </div>

        {/* Progress */}
        {phase === "running" && progress && (
          <div className="border rounded p-4 bg-blue-50">
            <p className="text-sm font-medium text-blue-800 mb-2">
              {progress.description ?? "Processing..."}
            </p>
            {progress.section && (
              <p className="text-xs text-blue-600 mb-2">
                Section: {progress.section}
                {progress.section_count
                  ? ` (${(progress.section_index ?? 0) + 1} of ${progress.section_count})`
                  : ""}
              </p>
            )}
            {progress.percent != null && (
              <div className="w-full bg-blue-200 rounded h-2">
                <div
                  className="bg-blue-600 rounded h-2 transition-all"
                  style={{
                    width: `${Math.min(progress.percent, 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Results ---- */}
      {phase === "completed" && result && (
        <div className="mt-8">
          <CuttingListView result={result} taskId={taskId} />
        </div>
      )}
    </div>
  );
}

