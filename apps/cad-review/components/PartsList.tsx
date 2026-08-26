"use client";

import { useCallback, useEffect, useState } from "react";
import { PartViewer } from "./PartViewer";
import { AssemblyWalker } from "./AssemblyWalker";

/**
 * Every part, grouped by designation, with its cut files.
 *
 * The review queue answers "what still needs me?". This answers "what did we make, and give
 * me the file" — which is how a job actually reaches the shop floor. Until this existed the
 * only way to get a DXF off the machine was for someone to copy the blobs out by hand.
 *
 * Grouped by designation because that is the useful noun: job 10353's 183 pieces are
 * thirteen designations. The grouping is done server-side — the client renders and issues
 * commands, nothing more.
 */

type Part = {
  fingerprint_key: string;
  mark: string | null;
  name: string | null;
  qty: number;
  length_mm: number | null;
  n_solids: number | null;
  artifacts: string[];
};

type Group = {
  designation: string | null;
  label: string;
  class: string | null;
  sized: boolean;
  parts: Part[];
  pieces: number;
  length_mm: number;
};

type Parts = {
  groups: Group[];
  totals: { designations: number; parts: number; pieces: number; with_cut_file: number };
};

export function PartsList({ modelId }: { modelId: string }) {
  const [data, setData] = useState<Parts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [walking, setWalking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/parts/`,
                              { cache: "no-store" });
      if (!res.ok) { setErr(`Parts returned ${res.status}`); return; }
      setData(await res.json()); setErr(null);
    } catch {
      setErr("Could not reach the CAD service");
    }
  }, [modelId]);

  useEffect(() => { load(); }, [load]);

  async function reclass(fk: string, type: string) {
    setBusy(true);
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/review/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint_key: fk, type }),
      });
      if (!res.ok) setErr(`review returned ${res.status}`);
      else await load();
    } catch {
      setErr("Could not reach the CAD service");
    } finally {
      setBusy(false);
    }
  }

  if (err) return <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{err}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading parts…</p>;

  const t = data.totals;
  const href = (fk: string, kind: string) =>
    `/cad-review/api/cad/models/${modelId}/prototype/${fk}/artifact/${kind}/`;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
        <span className="text-2xl font-semibold tabular-nums">{t.designations}</span>
        <span className="ml-2 text-slate-600">designations</span>
        <span className="ml-4 text-slate-500">
          {t.parts} parts · {t.pieces} pieces · {t.with_cut_file} with a cut file
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-3 min-w-0">
          {data.groups.map((g) => {
            const open = !shut.has(g.label);
            return (
              <div key={g.label} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button
                  onClick={() => {
                    const n = new Set(shut);
                    open ? n.add(g.label) : n.delete(g.label);
                    setShut(n);
                  }}
                  className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="text-slate-400 text-xs w-3">{open ? "▾" : "▸"}</span>
                  <span className={`font-semibold ${g.sized ? "text-slate-900" : "text-amber-700"}`}>
                    {g.label}
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {g.parts.length} {g.parts.length === 1 ? "part" : "parts"} · {g.pieces} pcs
                    {g.length_mm ? ` · ${(g.length_mm / 1000).toFixed(1)} m` : ""}
                  </span>
                </button>

                {open && (
                  <table className="w-full border-t border-slate-200 text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400">
                        <th className="px-3 py-1 font-medium">Mark</th>
                        <th className="px-2 py-1 font-medium">Part</th>
                        <th className="px-2 py-1 text-right font-medium">Qty</th>
                        <th className="px-2 py-1 text-right font-medium">Length</th>
                        <th className="px-2 py-1 font-medium">DXF</th>
                        <th className="px-2 py-1 font-medium">NC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.parts.map((p) => (
                        <tr key={p.fingerprint_key}
                            onClick={() => setSel(p.fingerprint_key)}
                            className={`cursor-pointer border-t border-slate-100 ${
                              sel === p.fingerprint_key ? "bg-slate-100" : "hover:bg-slate-50"}`}>
                          <td className="px-3 py-1 font-mono text-xs">{p.mark ?? "—"}</td>
                          <td className="max-w-0 truncate px-2 py-1 text-slate-700">
                            {p.name ?? ""}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{p.qty}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                            {p.length_mm ? Math.round(p.length_mm).toLocaleString() : "—"}
                          </td>
                          {["dxf", "nc1"].map((kind) => (
                            <td key={kind} className="px-2 py-1">
                              {p.artifacts.includes(kind) ? (
                                <a href={href(p.fingerprint_key, kind)}
                                   onClick={(e) => e.stopPropagation()}
                                   className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                                  {kind === "nc1" ? "NC1" : "DXF"}
                                </a>
                              ) : (
                                // An em dash, not an empty cell: the reader should be able
                                // to tell "no file" from "column did not render".
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>

        {/* A sticky column TALLER than the viewport cannot be scrolled to reach its lower
            half — it pins at top-4 and everything past the fold is unreachable. So the
            column is capped to the viewport and scrolls internally, and opening the walker
            REPLACES the part viewer rather than stacking beneath it: having asked to see the
            parent assembly, the assembly is what you want on screen. */}
        <div className="order-first md:order-none md:self-start md:sticky md:top-4 space-y-2
                        md:max-h-[calc(100vh-2rem)] md:overflow-y-auto">
          {!walking && (
            <div className="h-[26rem] md:h-[calc(100vh-16rem)] md:max-h-[34rem]">
              <PartViewer modelId={modelId} fingerprintKey={sel} />
            </div>
          )}
          {sel && walking && (
            <AssemblyWalker modelId={modelId} fingerprintKey={sel}
              onClose={() => setWalking(false)}
              onChanged={() => { setSel(null); load(); }} />
          )}

          {sel && !walking && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="mb-1.5 text-xs text-slate-500">
                Wrong about this part?
              </p>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy}
                  onClick={() => reclass(sel, "BOUGHT_OUT")}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                  Bought out
                </button>
                <button disabled={busy}
                  onClick={() => reclass(sel, "EXCLUDE")}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                  Exclude
                </button>
                {/* The usual case is not "this part is wrong" but "this part should never
                    have been a part" — it was torn out of something bought. */}
                <button disabled={busy} onClick={() => setWalking(true)}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                  Show parent assembly
                </button>
              </div>
              {/* Say what this cannot do. Re-classing the plate stops us costing it as
                  ours, but the handrail standard is still three lines in three groups -
                  a plate here, its tube in the sections, its ball in the fasteners. That
                  needs an assembly-level decision (bd rl2), and pretending otherwise would
                  leave someone believing the job was fixed. */}
              <p className="mt-2 text-xs text-slate-400 leading-snug">
                Bought out / Exclude change ONE part. If it was torn out of a purchased
                assembly, walk up instead — that keeps the whole thing together.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
