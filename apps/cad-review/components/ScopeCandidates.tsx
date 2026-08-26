"use client";

import { useCallback, useEffect, useState } from "react";
import { LevelPanel } from "./LevelPanel";

/**
 * Assemblies that look bought — small and repeated.
 *
 * Steve: "items which are repeated many times would be good to have on a list of possible
 * bought outs? maybe?"
 *
 * The judgement already existed. scope._decide marks exactly this shape "undecided —
 * repeated xN, small (M parts) — confirm unit?", and only the COUNT ever survived. So job
 * 10353's handrail standard was flagged and the flag was thrown away, leaving 18 plates and
 * 18 tubes in the cut list to be found by eye weeks later.
 *
 * This comes BEFORE review, because reviewing parts that should never have been analysed is
 * pure waste — and it is ordered by what confirming removes, so the top of the list is
 * always the click worth making.
 */

type Member = {
  fingerprint_key: string; class: string | null;
  designation: string | null; name: string | null; n: number;
  per_occurrence: number; scope: string | null;
};

type Candidate = {
  assembly_key: string;
  occurrences: number;
  instance_prefix: string | null;
  leaves_each: number;
  total_leaves: number;
  already_bought: number;
  pieces_removed: number;
  name: string | null;
  label: string;
  members: Member[];
};

export function ScopeCandidates({ modelId, onChanged }: {
  modelId: string; onChanged: () => void;
}) {
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sel, setSel] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/scope/candidates/`,
                              { cache: "no-store" });
      if (!res.ok) { setErr(`candidates returned ${res.status}`); return; }
      const d = await res.json();
      setRows(d.candidates); setTotal(d.total_pieces_removable); setErr(null);
    } catch { setErr("Could not reach the CAD service"); }
  }, [modelId]);

  useEffect(() => { load(); }, [load]);

  async function answer(key: string, treatment: "unit" | "explode", name?: string | null) {
    setBusy(key);
    setNote(treatment === "unit" ? "Reforming…" : "Recording…");
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/scope/unit/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assembly_key: key, designation: name ?? null, treatment }),
      });
      if (!res.ok) { setErr(`scope/unit returned ${res.status}`); return; }
      const { job_id } = await res.json();
      if (job_id) await waitFor(job_id, setNote);
      setSel(null); await load(); onChanged();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(null); setNote(""); }
  }

  if (err) return <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{err}</p>;
  if (!rows) return <p className="text-sm text-slate-500">Looking for repeated assemblies…</p>;

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
        Nothing looks like a bought assembly — no small, repeated groups left undecided.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
        <span className="text-2xl font-semibold tabular-nums">{rows.length}</span>
        <span className="ml-2 text-slate-600">
          {rows.length === 1 ? "assembly" : "assemblies"} look bought
        </span>
        <span className="ml-4 text-slate-500">
          up to <b className="tabular-nums">{total}</b> pieces would leave the cut list
        </span>
        <p className="mt-1 text-xs text-slate-400">
          Small and repeated. Confirming one takes its parts out of fabrication and remembers
          the shape for future jobs. Reversible.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_24rem]">
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white self-start">
        {rows.map((c) => (
          <li key={c.assembly_key}
              onClick={() => setSel(c)}
              className={`cursor-pointer border-l-4 px-4 py-2.5 transition ${
                sel?.assembly_key === c.assembly_key
                  ? "border-l-slate-900 bg-slate-100"
                  : "border-l-transparent hover:border-l-slate-300 hover:bg-slate-50"}`}>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={(e) => { e.stopPropagation();
                        setOpen(open === c.assembly_key ? null : c.assembly_key); }}
                      className="min-w-0 flex-1 text-left">
                {/* Composition, not the first member's name — two handrail standards
                    both came back called "63mm ball" and read as duplicates. */}
                <span className="text-sm font-medium">{c.label}</span>
                <span className="ml-2 text-xs text-slate-500 tabular-nums">
                  ×{c.occurrences}
                </span>
                {c.leaves_each < 2 && (
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                    single repeated part
                  </span>
                )}
                {/* The strongest signal in the set, so it is said plainly rather than
                    left for the reader to spot in the member list. */}
                {c.already_bought > 0 && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                    contains a bought part
                  </span>
                )}
              </button>
              <span className="text-xs text-slate-500 tabular-nums">
                removes {c.pieces_removed}
              </span>
              <button
                disabled={!!busy}
                onClick={(e) => { e.stopPropagation(); answer(c.assembly_key, "unit", c.name); }}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
                {busy === c.assembly_key ? note || "Working…" : "Bought — one line"}
              </button>
              {/* The other answer. Without it the list can only be agreed with, so an
                  assembly the reviewer has looked at and decided IS fabricated comes back
                  on every visit — and a list that regrows is one people stop reading. */}
              <button
                disabled={!!busy}
                onClick={(e) => { e.stopPropagation(); answer(c.assembly_key, "explode", c.name); }}
                title="We fabricate this — explode it, keep its parts as separate items, and stop asking"
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                Explode — we make this
              </button>
            </div>

            {open === c.assembly_key && (
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {c.members.map((m) => (
                    <tr key={m.fingerprint_key} className="border-t border-slate-100">
                      <td className="py-1 pr-2 text-slate-400">{m.class ?? "—"}</td>
                      <td className="py-1 pr-2">{m.designation ?? ""}</td>
                      <td className="max-w-0 truncate py-1 pr-2 text-slate-600">{m.name ?? ""}</td>
                      {/* Per OCCURRENCE. The header says "x17" for the assembly; putting a
                          total of 34 next to it just asks the reader to do division. */}
                      <td className="py-1 text-right tabular-nums whitespace-nowrap">
                        ×{m.per_occurrence} each
                        <span className="ml-1 text-slate-400">({m.n} total)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>

      <div className="order-first md:order-none md:self-start md:sticky md:top-4
                      md:max-h-[calc(100vh-2rem)] md:overflow-y-auto">
        {sel?.instance_prefix ? (
          <LevelPanel modelId={modelId} prefix={sel.instance_prefix}
                      offeredKey={sel.assembly_key} busy={!!busy}
                      onAnswer={(k, t) => answer(k, t, sel.name)} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
            Pick one to see it, and to step in or wider.
          </div>
        )}
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
