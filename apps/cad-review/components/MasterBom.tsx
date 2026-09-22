"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AssemblyList, CsvLinks, MaterialTable, SupplyPill, TotalsBar,
         type AssemblyLine, type PartLine, type Totals } from "./BomTables";

/**
 * The master bill of materials: every node marked done, collated (bd kl1y.7).
 *
 * Steve, 2026-09-22: "create BOM's as we go, which can eventually be collated into a master".
 * Identical assemblies from different nodes are one line; the material list sums by part. Top-level
 * items tagged bought out or free issue in the scope tree are single lines. And it says what it is
 * missing - the coverage list - instead of quietly presenting a part of the job as the whole.
 */

type Coverage = { prefix: string; name: string | null; parts: number; status: string };
type Unit = { prefix: string; name: string; qty: number; supply: "buy" | "free_issue";
              parts: number; mass_kg: number; mass_complete: boolean };
type Master = {
  nodes: { prefix: string; name: string | null }[];
  counted_in_outer: Record<string, string>;
  coverage: Coverage[]; units: Unit[];
  assemblies: AssemblyLine[]; material: PartLine[]; totals: Totals;
};

const TONE: Record<string, string> = {
  "signed off": "bg-emerald-100 text-emerald-800",
  "inside a signed-off node": "bg-emerald-50 text-emerald-700",
  "partly signed off": "bg-amber-100 text-amber-800",
  "bought out": "bg-emerald-100 text-emerald-800",
  "free issue": "bg-violet-100 text-violet-800",
  "excluded": "bg-slate-200 text-slate-600",
  "not yet": "bg-red-50 text-red-700",
};

export function MasterBom({ modelId }: { modelId: string }) {
  const [m, setM] = useState<Master | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"assemblies" | "material">("assemblies");
  const api = `/cad-review/api/cad/models/${modelId}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/master-bom/`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) { setErr(`master BOM returned ${res.status}`); return; }
        const body: Master = await res.json();
        if (live) setM(body);
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api]);

  if (err) return <p className="text-sm text-amber-800">{err}</p>;
  if (!m) return <p className="text-sm text-slate-500">Collating…</p>;

  const notYet = m.coverage.filter((c) => c.status === "not yet" || c.status === "partly signed off");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TotalsBar t={m.totals} />
        <CsvLinks href={(v) => `${api}/master-bom.csv?view=${v}`} />
      </div>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-700">
          What is in it — {m.nodes.length} node{m.nodes.length === 1 ? "" : "s"} marked done
          {notYet.length > 0 && <span className="ml-2 font-normal text-red-700">
            · {notYet.length} top-level node{notYet.length === 1 ? "" : "s"} not covered yet</span>}
        </h2>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
          {m.coverage.map((c) => (
            <li key={c.prefix} className="flex items-center gap-3 px-3 py-1.5">
              <span className={`w-44 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] ${
                TONE[c.status] ?? "bg-slate-100"}`}>{c.status}</span>
              <span className="min-w-0 flex-1 truncate">
                {c.name || <span className="font-mono text-slate-500">{c.prefix}</span>}
                <span className="ml-2 text-xs text-slate-500">
                  {c.parts?.toLocaleString()} part{c.parts === 1 ? "" : "s"}</span>
              </span>
              <Link href={`/${modelId}/isolate/?prefix=${encodeURIComponent(c.prefix)}`}
                    className="text-xs text-sky-700 hover:underline">work on it</Link>
            </li>
          ))}
        </ul>
      </section>

      {m.units.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-700">Taken whole</h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {m.units.map((u) => (
              <li key={u.prefix} className="flex items-center gap-3 px-3 py-1.5">
                <SupplyPill s={u.supply} />
                <span className="flex-1 truncate">{u.name}
                  <span className="ml-2 text-xs text-slate-500">
                    {u.parts} part{u.parts === 1 ? "" : "s"}</span></span>
                <span className="text-xs tabular-nums text-slate-600">
                  {(u.mass_kg / 1000).toFixed(2)} t{u.mass_complete ? "" : " (some unknown)"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {(["assemblies", "material"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${view === v
                    ? "border-slate-900 font-medium" : "border-transparent text-slate-500"}`}>
            {v === "assemblies" ? `Assemblies (${m.totals.assembly_kinds.toLocaleString()})`
              : `Material list (${m.totals.part_kinds.toLocaleString()})`}
          </button>
        ))}
      </div>
      {view === "assemblies"
        ? <AssemblyList rows={m.assemblies} modelId={modelId}
                        picPrefix={(a) => a.from?.[0]?.prefix ?? null} />
        : <MaterialTable rows={m.material} modelId={modelId} />}
    </div>
  );
}
