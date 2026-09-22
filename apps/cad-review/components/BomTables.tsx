"use client";

import { useState } from "react";
import { Thumb } from "./Thumb";

/**
 * The two halves of a bill of materials, shared by a node's BOM and the master (bd kl1y.7):
 * ASSEMBLIES - each kind of piece, how many, and what one of it is made of - and MATERIAL - every
 * part summed, which is what gets bought, cut and drilled.
 */

export type Supply = "make" | "buy" | "free_issue" | "excluded" | "mixed" | "unknown";
export type PartLine = {
  key: string; mark: string | null; designation: string | null; name: string;
  class: string | null; supply: Supply; length_mm: number | null; mass_each_kg: number | null;
  cut_file: "nc1" | "dxf" | null; qty: number; mass_total_kg?: number;
};
export type AssemblyLine = {
  key: string; label: string; name: string | null; accepted: boolean; qty: number;
  parts_per_piece: number; mass_each_kg: number; mass_total_kg: number; mass_complete: boolean;
  welds: number; weld_mm: number; bolted_to: number; bolts: number; supply: Supply;
  parts: PartLine[]; from?: { prefix: string; node: string | null; qty: number }[];
};
export type Totals = {
  assemblies: number; assembly_kinds: number; parts: number; part_kinds: number;
  mass_kg: Partial<Record<Supply, number>>; parts_mass_unknown: number;
};

const PAGE = 100;

export function TotalsBar({ t }: { t: Totals }) {
  const tonnes = (k: Supply) => ((t.mass_kg[k] ?? 0) / 1000).toFixed(1);
  return (
    <div className="flex flex-wrap gap-2">
      <Stat label="assemblies" value={t.assemblies.toLocaleString()}
            note={`${t.assembly_kinds.toLocaleString()} kinds`} />
      <Stat label="parts" value={t.parts.toLocaleString()}
            note={`${t.part_kinds.toLocaleString()} kinds`} />
      <Stat label="we make" value={`${tonnes("make")} t`} />
      {(t.mass_kg.buy ?? 0) > 0 && <Stat label="bought out" value={`${tonnes("buy")} t`} />}
      {(t.mass_kg.free_issue ?? 0) > 0 && <Stat label="free issue" value={`${tonnes("free_issue")} t`} />}
      {(t.mass_kg.excluded ?? 0) > 0 && <Stat label="excluded" value={`${tonnes("excluded")} t`} />}
      {(t.mass_kg.unknown ?? 0) > 0 && <Stat label="unclassified" value={`${tonnes("unknown")} t`} />}
      {t.parts_mass_unknown > 0 && (
        <Stat label="mass unknown" value={`${t.parts_mass_unknown} parts`} />
      )}
    </div>
  );
}

export function AssemblyList({ rows, modelId, picPrefix }: {
  rows: AssemblyLine[]; modelId: string;
  /** Which node a piece's picture is drawn from (the master passes each line's first node). */
  picPrefix: (a: AssemblyLine) => string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const api = `/cad-review/api/cad/models/${modelId}`;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.slice(0, shown).map((a) => {
          const isOpen = open.has(a.key);
          const pp = picPrefix(a);
          return (
            <li key={a.key}>
              <button onClick={() => setOpen((s) => {
                        const n = new Set(s); if (n.has(a.key)) n.delete(a.key); else n.add(a.key);
                        return n; })}
                      className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-slate-50">
                <span className="w-4 text-slate-500">{isOpen ? "▾" : "▸"}</span>
                {pp ? <Thumb src={`${api}/isolate/piece-thumbnail/?prefix=${encodeURIComponent(pp)}`
                                   + `&piece=${a.key}`} className="h-[40px] w-[58px]" />
                    : <span className="h-[40px] w-[58px] shrink-0 rounded bg-slate-100" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.name || a.label}
                    {a.accepted && <span className="ml-2 text-xs font-normal text-slate-500">accepted</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {a.parts_per_piece} part{a.parts_per_piece === 1 ? "" : "s"} each
                    {a.welds > 0 && ` · ${a.welds} welds`}
                    {a.bolted_to > 0 && ` · bolted to ${a.bolted_to}`}
                    {a.from && a.from.length > 1 && ` · from ${a.from.length} nodes`}
                  </div>
                </div>
                <SupplyPill s={a.supply} />
                <span className="w-12 text-right text-sm tabular-nums">×{a.qty}</span>
                <span className="w-20 text-right text-xs tabular-nums text-slate-600">
                  {a.mass_each_kg.toFixed(1)} kg ea</span>
                <span className="w-20 text-right text-xs tabular-nums text-slate-600">
                  {(a.mass_total_kg / 1000).toFixed(2)} t</span>
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
                  <PartsTable rows={a.parts} modelId={modelId} perPiece={a.qty} />
                </div>
              )}
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Nothing here yet.</li>}
      </ul>
      <More total={rows.length} shown={shown} setShown={setShown} />
    </div>
  );
}

function PartsTable({ rows, modelId, perPiece }: {
  rows: PartLine[]; modelId: string; perPiece: number;
}) {
  return (
    <table className="w-full text-xs">
      <thead className="text-slate-500">
        <tr>
          <th className="py-1 text-left font-medium">Mark</th>
          <th className="py-1 text-left font-medium">Part</th>
          <th className="py-1 text-right font-medium">Each</th>
          <th className="py-1 text-right font-medium">Total</th>
          <th className="py-1 text-right font-medium">Length</th>
          <th className="py-1 text-right font-medium">kg each</th>
          <th className="py-1 text-left font-medium pl-3">Supply</th>
          <th className="py-1 text-left font-medium">Cut file</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((p) => (
          <tr key={p.key}>
            <td className="py-1 font-mono">{p.mark ?? "—"}</td>
            <td className="py-1">{p.name}</td>
            <td className="py-1 text-right tabular-nums">{p.qty}</td>
            <td className="py-1 text-right tabular-nums">{p.qty * perPiece}</td>
            <td className="py-1 text-right tabular-nums">{p.length_mm ? `${Math.round(p.length_mm)}` : "—"}</td>
            <td className="py-1 text-right tabular-nums">{p.mass_each_kg ?? "?"}</td>
            <td className="py-1 pl-3"><SupplyPill s={p.supply} /></td>
            <td className="py-1"><CutFile modelId={modelId} p={p} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MaterialTable({ rows, modelId }: { rows: PartLine[]; modelId: string }) {
  const [shown, setShown] = useState(PAGE);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = needle ? rows.filter((m) => `${m.mark ?? ""} ${m.name} ${m.designation ?? ""}`
    .toLowerCase().includes(needle)) : rows;
  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
             placeholder="Find a mark or size…"
             className="w-56 rounded border border-slate-300 px-2 py-1 text-sm" />
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Mark</th>
              <th className="px-3 py-2 text-left font-medium">Part</th>
              <th className="px-3 py-2 text-left font-medium">Supply</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Length (mm)</th>
              <th className="px-3 py-2 text-right font-medium">kg each</th>
              <th className="px-3 py-2 text-right font-medium">kg total</th>
              <th className="px-3 py-2 text-left font-medium">Cut file</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.slice(0, shown).map((m) => (
              <tr key={m.key} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 font-mono text-xs">{m.mark ?? "—"}</td>
                <td className="px-3 py-1.5">{m.name}</td>
                <td className="px-3 py-1.5"><SupplyPill s={m.supply} /></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{m.qty.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {m.length_mm ? Math.round(m.length_mm).toLocaleString() : "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{m.mass_each_kg ?? "?"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {(m.mass_total_kg ?? 0).toLocaleString()}</td>
                <td className="px-3 py-1.5"><CutFile modelId={modelId} p={m} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <More total={list.length} shown={shown} setShown={setShown} />
    </div>
  );
}

function CutFile({ modelId, p }: { modelId: string; p: PartLine }) {
  if (!p.cut_file) return <span className="text-slate-400">—</span>;
  return (
    <a href={`/cad-review/api/cad/models/${modelId}/prototype/${p.key}/artifact/${p.cut_file}/`}
       className="text-sky-700 underline">{p.cut_file.toUpperCase()}</a>
  );
}

function More({ total, shown, setShown }: {
  total: number; shown: number; setShown: (f: (n: number) => number) => void;
}) {
  if (total <= shown) return null;
  return (
    <button onClick={() => setShown((n) => n + PAGE)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
      Show {Math.min(PAGE, total - shown)} more of {(total - shown).toLocaleString()}
    </button>
  );
}

export function CsvLinks({ href }: { href: (view: "assemblies" | "material") => string }) {
  return (
    <div className="flex gap-2">
      <a href={href("assemblies")}
         className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">Assemblies CSV</a>
      <a href={href("material")}
         className="rounded border border-slate-300 px-3 py-1.5 text-sm">Material list CSV</a>
    </div>
  );
}

export function SupplyPill({ s }: { s: Supply }) {
  const look: Record<Supply, string> = {
    make: "bg-sky-100 text-sky-800", buy: "bg-emerald-100 text-emerald-800",
    free_issue: "bg-violet-100 text-violet-800", excluded: "bg-slate-200 text-slate-600",
    mixed: "bg-amber-100 text-amber-800", unknown: "bg-slate-100 text-slate-600",
  };
  const text: Record<Supply, string> = {
    make: "made", buy: "bought", free_issue: "free issue", excluded: "excluded",
    mixed: "mixed", unknown: "unclassified",
  };
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${look[s] ?? look.unknown}`}>
    {text[s] ?? s}</span>;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      {note && <div className="text-[11px] text-slate-500">{note}</div>}
    </div>
  );
}

