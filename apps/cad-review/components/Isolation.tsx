"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssemblyViewer } from "./AssemblyViewer";
import { PreparePicturesBar } from "./PreparePictures";
import { Thumb } from "./Thumb";

/**
 * Work in isolation: one node, and the pieces it splits into (bd kl1y).
 *
 * Steve, 2026-09-22: "the tree will become to unweildy if we start expanding further. i think we
 * need a 'work in isolation' option ... First thing 'in isolation' start esitmating bolted
 * connections and create subgroups of assemblies. then we should be able to recurse into the sub
 * assemblies 'work in isolation' drilling down and refining."
 *
 * A PIECE is what arrives as one thing: parts welded together, with bolts as the boundaries
 * between pieces. Identical pieces are one line with a quantity - 10335's structure is 4,015
 * pieces but about 1,200 kinds, and a hundred identical frames are one decision, not a hundred.
 */

type Mark = { mark: string | null; class: string | null; designation: string | null;
              name: string | null; qty: number };
type Piece = {
  key: string; label: string; qty: number; parts: number;
  mass_kg: number; total_kg: number; mass_complete: boolean;
  weld_count: number; weld_length_mm: number; bolted_to: number; bolts: number;
  not_fabricated: boolean; supply: "make" | "buy" | "free_issue" | "mixed" | "unknown";
  marks: Mark[]; more_marks: number;
};
type Scope = {
  prefix: string; name: string | null;
  breadcrumbs: { prefix: string; name: string | null }[];
  parts: number;
  detection: { revision: number; label: string | null; created_at: string;
               carried_from: { model: string; revision: number } | null } | null;
  accepted: number;
  can_accept: boolean;
  joints: { weld: number; bolt: number; contact: number; crossing: number; excluded: number };
  summary: { piece_types: number; pieces: number; single_part_pieces: number;
             mass_kg: number; mass_complete: boolean };
  pieces: Piece[];
};

type Supply = "all" | "make" | "buy" | "mixed";
const PAGE = 150;

export function Isolation({ modelId, prefix }: { modelId: string; prefix: string }) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Piece | null>(null);
  const [q, setQ] = useState("");
  const [supply, setSupply] = useState<Supply>("all");
  const [singles, setSingles] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [picsMissing, setPicsMissing] = useState(false);
  const [picsVersion, setPicsVersion] = useState(0);
  const onPicsMissing = useCallback(() => setPicsMissing(true), []);
  const [reload, setReload] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [acceptNote, setAcceptNote] = useState<string | null>(null);

  const api = `/cad-review/api/cad/models/${modelId}`;
  const qs = `prefix=${encodeURIComponent(prefix)}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/isolate/?${qs}`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErr(body?.detail ?? `isolate returned ${res.status}`); return;
        }
        const body = await res.json();
        if (live) { setErr(null); setScope(body); }
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, qs, reload]);

  async function accept() {
    setAccepting(true); setAcceptNote(null);
    try {
      const res = await fetch(`${api}/isolate/accept/?${qs}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setAcceptNote(body?.detail ?? `accept returned ${res.status}`); return; }
      setAcceptNote(`${body.accepted.toLocaleString()} pieces accepted as sub-assemblies of this `
        + `node${body.left_to_human ? ` — ${body.left_to_human} parts you grouped by hand were `
        + `left where you put them` : ""}${body.straddling_groups ? ` — ${body.straddling_groups} `
        + `pieces reaching outside this node were left alone` : ""}.`);
      setReload((n) => n + 1);
    } catch { setAcceptNote("Could not reach the CAD service"); }
    finally { setAccepting(false); }
  }

  const pieces = useMemo(() => {
    if (!scope) return [];
    const needle = q.trim().toLowerCase();
    return scope.pieces.filter((p) =>
      (supply === "all" || p.supply === supply)
      && (singles || p.parts > 1)
      && (!needle || p.label.toLowerCase().includes(needle)
          || p.marks.some((m) => (m.mark ?? "").toLowerCase().includes(needle)
                              || (m.designation ?? "").toLowerCase().includes(needle))));
  }, [scope, q, supply, singles]);

  if (err) return <Warn>{err}</Warn>;
  if (!scope) {
    return <p className="mt-4 text-sm text-slate-500">
      Working out the pieces in this node… (a few seconds on a large one)</p>;
  }

  const s = scope.summary;
  const j = scope.joints;
  const pic = (p: Piece) =>
    `${api}/isolate/piece-thumbnail/?${qs}&piece=${p.key}`;

  return (
    <div className="mt-2 space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
        {scope.breadcrumbs.map((c, i) => {
          const last = i === scope.breadcrumbs.length - 1;
          const label = c.name || c.prefix.split("/").pop();
          return (
            <span key={c.prefix} className="flex items-center gap-1">
              {i > 0 && <span>›</span>}
              {last ? <span className="font-medium text-slate-900">{label}</span>
                : <Link href={`/${modelId}/isolate/?prefix=${encodeURIComponent(c.prefix)}`}
                        className="hover:text-slate-900 hover:underline">{label}</Link>}
            </span>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {scope.name || <span className="font-mono">{scope.prefix}</span>}
          </h1>
          <p className="text-sm text-slate-500">Working in isolation — only this node is shown.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Stat label="parts" value={scope.parts.toLocaleString()} />
          <Stat label="pieces" value={`${s.pieces.toLocaleString()}`}
                note={`${s.piece_types.toLocaleString()} kinds`} />
          <Stat label="mass" value={`${(s.mass_kg / 1000).toFixed(1)} t`}
                note={s.mass_complete ? undefined : "some unknown"} />
          <Stat label="bolted joints" value={j.bolt.toLocaleString()} />
          <Stat label="welded joints" value={j.weld.toLocaleString()} />
          <Stat label="touching" value={j.contact.toLocaleString()} />
        </div>
      </div>

      <Detection scope={scope} />

      {scope.detection && scope.can_accept && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-300
                        bg-slate-50 px-4 py-2 text-sm">
          {scope.accepted > 0 ? (
            <span className="text-slate-700">
              <strong>{scope.accepted.toLocaleString()}</strong> pieces accepted as sub-assemblies
              of this node. They are what the shop tree and the erection planner now see.
            </span>
          ) : (
            <span className="text-slate-700">
              Happy with how this node splits? Accept the{" "}
              <strong>{s.pieces.toLocaleString()}</strong> pieces as its sub-assemblies.
            </span>
          )}
          <button onClick={accept} disabled={accepting}
                  className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">
            {accepting ? "Accepting…" : scope.accepted > 0 ? "Accept again" : "Accept pieces"}
          </button>
          {acceptNote && <span className="text-xs text-slate-600">{acceptNote}</span>}
        </div>
      )}

      {picsMissing && (
        <PreparePicturesBar modelId={modelId} onDone={() => {
          setPicsMissing(false); setPicsVersion((v) => v + 1);
        }} />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
                   placeholder="Find a size or mark…"
                   className="w-56 rounded border border-slate-300 px-2 py-1 text-sm" />
            {(["all", "make", "buy", "mixed"] as Supply[]).map((k) => (
              <button key={k} onClick={() => { setSupply(k); setShown(PAGE); }}
                      className={`rounded px-2.5 py-1 text-xs ${supply === k
                        ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600"}`}>
                {k === "all" ? "All" : k === "make" ? "Made" : k === "buy" ? "Bought" : "Mixed"}
              </button>
            ))}
            <label className="ml-1 flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={singles}
                     onChange={(e) => { setSingles(e.target.checked); setShown(PAGE); }} />
              single parts ({s.single_part_pieces.toLocaleString()})
            </label>
            <span className="ml-auto text-xs text-slate-500">
              {pieces.length.toLocaleString()} kinds · heaviest first
            </span>
          </div>

          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {pieces.slice(0, shown).map((p) => (
              <li key={p.key} onClick={() => setSel(p)}
                  className={`flex cursor-pointer items-center gap-3 border-l-4 px-3 py-1.5 ${
                    sel?.key === p.key ? "border-l-slate-900 bg-slate-100"
                      : "border-l-transparent hover:bg-slate-50"}`}>
                <Thumb key={picsVersion} src={pic(p)} onNotReady={onPicsMissing}
                       className="h-[44px] w-[64px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.label}</div>
                  <div className="truncate text-xs text-slate-500">
                    {p.parts} part{p.parts === 1 ? "" : "s"}
                    {p.weld_count > 0 && ` · ${p.weld_count} welds`}
                    {p.bolted_to > 0 && ` · bolted to ${p.bolted_to}`}
                  </div>
                </div>
                <SupplyPill s={p.supply} />
                <div className="w-14 text-right text-sm tabular-nums">×{p.qty}</div>
                <div className="w-20 text-right text-xs tabular-nums text-slate-600">
                  {(p.total_kg / 1000).toFixed(2)} t
                </div>
              </li>
            ))}
            {pieces.length === 0 && (
              <li className="px-3 py-3 text-sm text-slate-500">Nothing matches.</li>
            )}
          </ul>
          {pieces.length > shown && (
            <button onClick={() => setShown((n) => n + PAGE)}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
              Show {Math.min(PAGE, pieces.length - shown)} more of{" "}
              {(pieces.length - shown).toLocaleString()}
            </button>
          )}
        </div>

        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          {sel ? <PieceDetail p={sel} src={pic(sel)} version={picsVersion}
                              onNotReady={onPicsMissing} onClose={() => setSel(null)} />
            : <AssemblyViewer modelId={modelId} prefix={prefix} className="h-[26rem]" />}
        </div>
      </div>
    </div>
  );
}

function Detection({ scope }: { scope: Scope }) {
  const d = scope.detection;
  if (!d) {
    return (
      <Warn>
        No joints have been found for this model yet, so every part is listed as a piece of its
        own. Finding them for a node this size runs as a background job — that tool comes next.
      </Warn>
    );
  }
  return (
    <p className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
      Pieces are parts <strong>welded</strong> together; a <strong>bolted</strong> joint is where
      one piece ends and the next begins.{" "}
      {d.carried_from
        ? <>Joints carried from an earlier ingest of the same file (detection {d.carried_from
            .revision}), not re-measured. Weld lengths from that run read about 39% high — fine
            for grouping, not yet for pricing weld.</>
        : <>From detection {d.revision}{d.label ? ` (${d.label})` : ""}.</>}
      {scope.joints.crossing > 0 && <> {scope.joints.crossing} joints cross the edge of this
        node.</>}
    </p>
  );
}

function PieceDetail({ p, src, version, onNotReady, onClose }: {
  p: Piece; src: string; version: number; onNotReady: () => void; onClose: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">{p.label}</div>
          <div className="text-xs text-slate-500">
            ×{p.qty} · {p.parts} part{p.parts === 1 ? "" : "s"} each ·{" "}
            {p.mass_kg.toFixed(1)} kg each{p.mass_complete ? "" : " (some unknown)"}
          </div>
        </div>
        <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-900">✕</button>
      </div>
      <Thumb key={version} src={src} onNotReady={onNotReady} className="h-[15rem] w-full" />
      <div className="flex flex-wrap gap-2 text-xs">
        <SupplyPill s={p.supply} />
        {p.weld_count > 0 && <span className="text-slate-600">
          {p.weld_count} welds inside</span>}
        {p.bolted_to > 0 && <span className="text-slate-600">
          bolted to {p.bolted_to} other piece{p.bolted_to === 1 ? "" : "s"}
          {p.bolts > 0 && ` (${p.bolts} bolts)`}</span>}
      </div>
      <table className="w-full text-xs">
        <thead className="text-slate-500">
          <tr><th className="py-1 text-left font-medium">Mark</th>
              <th className="py-1 text-left font-medium">Part</th>
              <th className="py-1 text-right font-medium">Qty</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {p.marks.map((m, i) => (
            <tr key={`${m.mark}-${i}`}>
              <td className="py-1 font-mono">{m.mark ?? "—"}</td>
              <td className="py-1">{m.designation
                ?? (m.class ? m.class.replace(/_/g, " ").toLowerCase() : "—")}</td>
              <td className="py-1 text-right tabular-nums">{m.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.more_marks > 0 && (
        <p className="text-xs text-slate-500">…and {p.more_marks} more kinds of part.</p>
      )}
      <p className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Next: open this piece in isolation, split it at a joint, or merge it across a bolt.
      </p>
    </div>
  );
}

function SupplyPill({ s }: { s: Piece["supply"] }) {
  const look: Record<Piece["supply"], string> = {
    make: "bg-sky-100 text-sky-800", buy: "bg-emerald-100 text-emerald-800",
    free_issue: "bg-violet-100 text-violet-800", mixed: "bg-amber-100 text-amber-800",
    unknown: "bg-slate-100 text-slate-600",
  };
  const text: Record<Piece["supply"], string> = {
    make: "made", buy: "bought", free_issue: "free issue", mixed: "mixed", unknown: "unknown",
  };
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${look[s]}`}>{text[s]}</span>;
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

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      {children}
    </p>
  );
}
