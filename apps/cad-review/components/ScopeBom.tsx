"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LevelBar, type LevelRow } from "./LevelBar";
import { AccessSchedule, AssemblyList, CsvLinks, MaterialTable, TotalsBar,
         type AccessLine, type AccessTotals, type AssemblyLine, type PartLine,
         type StairRun, type Totals } from "./BomTables";

/**
 * One node's bill of materials, as it stands (bd kl1y.7).
 *
 * Derived live from the node's pieces - the same grouping, rules and edits the Pieces view shows -
 * so it follows every change. "Mark this node's BOM done" is a person's word that the node has
 * been worked through; the master BOM collates the nodes marked done.
 */

type Bom = {
  prefix: string; name: string | null;
  /** The node a floor at a time, and which floor this BOM is for (bd s8r8.5). */
  levels?: LevelRow[]; level?: string | null;
  signoff: { signed_at: string; note: string | null } | null;
  assemblies: AssemblyLine[]; material: PartLine[]; totals: Totals;
  access: { lines: AccessLine[]; totals: AccessTotals; runs?: StairRun[];
            levels_without_access?: string[] };
};

export function ScopeBom({ modelId, prefix }: { modelId: string; prefix: string }) {
  const [bom, setBom] = useState<Bom | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"assemblies" | "material" | "access">("assemblies");
  const [reload, setReload] = useState(0);
  const [level, setLevel] = useState("");
  const [busy, setBusy] = useState(false);

  const api = `/cad-review/api/cad/models/${modelId}`;
  const qs = `prefix=${encodeURIComponent(prefix)}`
    + (level ? `&level=${encodeURIComponent(level)}` : "");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/isolate/bom/?${qs}`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) { setErr(`BOM returned ${res.status}`); return; }
        const body: Bom = await res.json();
        if (live) { setErr(null); setBom(body); }
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, qs, reload]);

  async function signOff(done: boolean) {
    setBusy(true); setErr(null);
    try {
      const res = done
        ? await fetch(`${api}/isolate/signoff/`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prefix, level }) })
        : await fetch(`${api}/isolate/signoff/?${qs}`, { method: "DELETE" });
      if (!res.ok) { setErr(`sign-off returned ${res.status}`); return; }
      setReload((n) => n + 1);
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  if (err && !bom) return <p className="text-sm text-amber-800">{err}</p>;
  if (!bom) return <p className="text-sm text-slate-500">Working out the bill of materials…</p>;

  return (
    <div className="space-y-3">
      {(bom.levels?.length ?? 0) > 1 && (
        <LevelBar levels={bom.levels!} level={level} onPick={setLevel} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TotalsBar t={bom.totals} />
        <CsvLinks href={(v) => `${api}/isolate/bom.csv?${qs}&view=${v}`}
                  access={!!bom.access?.lines?.length} />
      </div>

      <div className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2 text-sm ${
        bom.signoff ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-slate-50"}`}>
        {bom.signoff ? (
          <>
            <span className="text-emerald-900">
              {level || "This node"} marked done{" "}
              {new Date(bom.signoff.signed_at).toLocaleString()} — it is in the master BOM, and
              follows any change made to it since.
            </span>
            <Link href={`/${modelId}/?tab=master`}
                  className="rounded bg-slate-900 px-3 py-1 text-xs text-white">See the master BOM</Link>
            <button onClick={() => signOff(false)} disabled={busy}
                    className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">
              Take it out again</button>
          </>
        ) : (
          <>
            <span className="text-slate-700">
              When {level ? `the pieces at ${level} are` : "this node’s pieces are"} right, mark
              {level ? " that level" : " its BOM"} done and it is collated into the master BOM.
            </span>
            <button onClick={() => signOff(true)} disabled={busy}
                    className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
              Mark {level ? level : "this node’s BOM"} done</button>
          </>
        )}
        {err && <span className="text-amber-800">{err}</span>}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(["assemblies", "material", "access"] as const).map((v) => (
          v === "access" && !bom.access?.lines?.length ? null : (
          <button key={v} onClick={() => setView(v)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${view === v
                    ? "border-slate-900 font-medium" : "border-transparent text-slate-500"}`}>
            {v === "assemblies" ? `Assemblies (${bom.totals.assembly_kinds.toLocaleString()})`
              : v === "material" ? `Material list (${bom.totals.part_kinds.toLocaleString()})`
              : `Stairs & access (${bom.access.lines.length.toLocaleString()})`}
          </button>)
        ))}
      </div>
      {view === "assemblies"
        ? <AssemblyList rows={bom.assemblies} modelId={modelId} picPrefix={() => prefix} />
        : view === "material"
        ? <MaterialTable rows={bom.material} modelId={modelId} />
        : <AccessSchedule rows={bom.access.lines} totals={bom.access.totals}
                          runs={bom.access.runs}
                          missing={bom.access.levels_without_access} />}
    </div>
  );
}
