"use client";

import { useCallback, useEffect, useState } from "react";
import { AssemblyViewer } from "./AssemblyViewer";

/**
 * Walk the assembly tree from the top, deciding what to open (bd iip).
 *
 * Steve: "if we look at the assembly tree from the top level, and show the user views of the
 * assemblies at that level this would allow them to yes/no the explode option. this could be
 * repeated for each level down following a route from the first explosion." And on job 10335:
 * "i would say yes to exploding the building, but no to those bought out items."
 *
 * KEEP-WHOLE STOPS THE DESCENT, which is what makes this tractable: the work is proportional
 * to what you choose to open, not to the size of the model. Say no to the bought equipment
 * and its thirty solids are never asked about again. On 10335 the top ten nodes carry 58% of
 * the work, so ten looks-and-decides covers most of a 15,000-piece job.
 *
 * WHY A VIEW AND NOT A LIST. You cannot tell from a name whether "3D FILTRO CIRCUITO DI
 * SEPARAZIONE" is bought equipment or fabricated steelwork. For this judgement, seeing beats
 * reading — the same lesson as the purlin named off a cross-section chart.
 */

type Node = {
  instance_prefix: string;
  node: string;
  name: string | null;
  leaves: number;
  distinct_prototypes: number;
  is_leaf: boolean;
  already_bought: number;
  consumed: number;
  decision: string | null;          // "unit" | "explode" | null
  assembly_key: string | null;
};

type Level = { prefix: string | null; children: Node[]; total_leaves: number;
               child_count: number; capped: boolean };

export function ScopeTree({ modelId, onChanged }: {
  modelId: string; onChanged: () => void;
}) {
  // The route taken down, so "back" is a step rather than a restart.
  const [path, setPath] = useState<{ prefix: string | null; label: string }[]>(
    [{ prefix: null, label: "Whole model" }]);
  const [level, setLevel] = useState<Level | null>(null);
  const [sel, setSel] = useState<Node | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const here = path[path.length - 1];

  const load = useCallback(async (prefix: string | null) => {
    setErr(null);
    try {
      const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/tree/${q}`,
                              { cache: "no-store" });
      if (!res.ok) { setErr(`tree returned ${res.status}`); return; }
      setLevel(await res.json());
    } catch { setErr("Could not reach the CAD service"); }
  }, [modelId]);

  useEffect(() => { load(here.prefix); setSel(null); }, [here.prefix, load]);

  function descend(n: Node) {
    if (n.is_leaf) return;
    setPath([...path, { prefix: n.instance_prefix, label: n.name || n.node }]);
  }

  async function decide(n: Node, treatment: "unit" | "explode") {
    if (!n.assembly_key) { setErr("This node has no assembly identity to decide on."); return; }
    setBusy(n.instance_prefix);
    setNote(treatment === "unit" ? "Keeping whole…" : "Recording…");
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/scope/unit/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assembly_key: n.assembly_key, designation: n.name, treatment }),
      });
      if (!res.ok) { setErr(`scope/unit returned ${res.status}`); return; }
      const { job_id } = await res.json();
      if (job_id) await waitFor(job_id, setNote);
      await load(here.prefix); onChanged();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(null); setNote(""); }
  }

  if (err) return <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{err}</p>;
  if (!level) return <p className="text-sm text-slate-500">Reading the assembly tree…</p>;

  return (
    <div className="space-y-3">
      {/* The route down, so a wrong turn costs one click rather than starting again. */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {path.map((p, i) => (
          <span key={p.prefix ?? "root"} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300">/</span>}
            <button
              onClick={() => setPath(path.slice(0, i + 1))}
              className={i === path.length - 1
                ? "font-medium text-slate-900"
                : "text-slate-500 hover:text-slate-800 hover:underline"}>
              {p.label}
            </button>
          </span>
        ))}
        <span className="ml-2 text-xs text-slate-500 tabular-nums">
          {level.child_count} node{level.child_count === 1 ? "" : "s"} · {level.total_leaves} parts below
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_24rem]">
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white self-start">
          {level.children.map((n) => {
            const share = level.total_leaves
              ? Math.round((n.leaves / level.total_leaves) * 100) : 0;
            return (
              <li key={n.instance_prefix}
                  onClick={() => setSel(n)}
                  className={`cursor-pointer border-l-4 px-4 py-2.5 transition ${
                    sel?.instance_prefix === n.instance_prefix
                      ? "border-l-slate-900 bg-slate-100"
                      : "border-l-transparent hover:border-l-slate-300 hover:bg-slate-50"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">
                      {n.name || <span className="font-mono text-slate-500">{n.node}</span>}
                    </span>
                    <span className="ml-2 text-xs text-slate-500 tabular-nums">
                      {n.leaves} part{n.leaves === 1 ? "" : "s"}
                      {share >= 5 && <span className="text-slate-400"> · {share}% of this level</span>}
                      {n.distinct_prototypes > 1 && ` · ${n.distinct_prototypes} distinct`}
                    </span>
                    {n.already_bought > 0 && (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                        {n.already_bought} bought inside
                      </span>
                    )}
                    {/* Shown WITH its answer rather than hidden — a scope screen that quietly
                        omits last week's decisions cannot be audited. */}
                    {n.decision && (
                      <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">
                        {n.decision === "unit" ? "kept whole" : "exploded"}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {!n.is_leaf && (
                      <button onClick={() => descend(n)}
                        className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                        Open →
                      </button>
                    )}
                    <button
                      disabled={!!busy || !n.assembly_key}
                      onClick={() => decide(n, "unit")}
                      title="Bought as one item — we do not fabricate its parts, and this stops the descent"
                      className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
                      {busy === n.instance_prefix ? note || "Working…" : "Keep whole"}
                    </button>
                    <button
                      disabled={!!busy || !n.assembly_key}
                      onClick={() => decide(n, "explode")}
                      title="We fabricate this — break it into its parts and stop asking"
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                      Explode
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          {level.capped && (
            <li className="px-4 py-2 text-xs text-amber-700">
              Only the largest {level.children.length} of {level.child_count} shown — the rest
              carry less work.
            </li>
          )}
        </ul>

        <div className="order-first md:order-none md:self-start md:sticky md:top-4
                        h-[26rem] md:h-[calc(100vh-12rem)] md:max-h-[36rem] md:overflow-y-auto">
          <AssemblyViewer modelId={modelId} prefix={sel?.instance_prefix ?? null}
                          className="h-full" />
        </div>
      </div>
    </div>
  );
}

async function waitFor(jobId: string, note: (s: string) => void, tries = 120) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const res = await fetch(`/cad-review/api/cad/jobs/${jobId}/`, { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      if (j.status === "done" || j.status === "completed") {
        if (j.result?.produce_job_id) {
          note("Re-producing…");
          return waitFor(j.result.produce_job_id, note, tries);
        }
        return;
      }
      if (j.status === "failed" || j.status === "error") return;
      if (j.phase) note(`${j.phase}…`);
    } catch { return; }
  }
}
