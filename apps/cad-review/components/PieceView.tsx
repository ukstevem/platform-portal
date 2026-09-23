"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PieceEditor, type Highlight } from "./PieceEditor";

/**
 * One kind of piece, opened up so it can be refined (bd kl1y.6).
 *
 * Geometry found the joints; which of them hold a piece together is the fabricator's call. That
 * call is made about KINDS of part - "PFC180 to a cleat is a site weld", "purlins are always
 * bolted" - so every action here records a RULE about a kind or a pair of kinds, and it applies
 * to every identical piece at once. On job 10335, 178 of the 256 joints fusing a 435-part piece
 * are one such pair.
 *
 * Nothing is saved without a preview: each action first shows what this piece would become and
 * what happens across the whole node, and only "Save rule" records it.
 */

type Kind = { kind: string; name: string; class: string | null; designation: string | null;
              supply: string | null; never_weld: boolean; qty: number; mass_kg: number;
              marks: string[] };
type Joint = { kind_a: string; kind_b: string; name_a: string; name_b: string; joint: string;
               count: number; weld_mm?: number; bolts?: number; site: boolean; shop: boolean };
type Rule = { id?: number; rule: "never_weld" | "site" | "shop"; kind_a: string;
              kind_b?: string; note?: string | null };
type Headline = { pieces: number; piece_types: number; largest: number };
type Detail = {
  prefix: string;
  piece: { key: string; label: string; qty: number; parts: number; mass_kg: number;
           supply: string; weld_count: number; bolted_to: number };
  parts: Kind[]; joints_inside: Joint[]; joints_out: Joint[];
  accepted_key: string | null; accepted: { name: string; named_by: string | null } | null;
  rules: Rule[];
  preview?: { trial: Rule & { remove?: boolean }; becomes_count: number;
              becomes: { label: string; parts: number; from_this_piece: number;
                         from_elsewhere: number }[];
              node_before: Headline; node_after: Headline };
};

export function PieceView({ modelId, prefix, piece }: {
  modelId: string; prefix: string; piece: string;
}) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [preview, setPreview] = useState<Detail["preview"] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [name, setName] = useState("");
  // Which kinds the model should light up: set by hovering a rules row, so a rule is checked
  // against the steel before it is saved.
  const [lit, setLit] = useState<Highlight>(null);

  const api = `/cad-review/api/cad/models/${modelId}`;
  const qs = `prefix=${encodeURIComponent(prefix)}`;
  const nodeHref = `/${modelId}/isolate/?${qs}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/isolate/piece/?${qs}&piece=${piece}`, { cache: "no-store" });
        if (!live) return;
        if (res.status === 404) { setGone(true); return; }
        if (!res.ok) { setErr(`piece returned ${res.status}`); return; }
        const body: Detail = await res.json();
        if (!live) return;
        setErr(null); setD(body); setName(body.accepted?.name ?? "");
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, qs, piece, reload]);

  async function tryRule(rule: Rule & { remove?: boolean }) {
    setBusy("Working out what that would do…"); setErr(null); setPreview(null);
    try {
      const res = await fetch(`${api}/isolate/piece/preview/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, piece, ...rule }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.detail ?? `preview returned ${res.status}`); return; }
      setPreview(body.preview);
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(null); }
  }

  async function saveRule() {
    if (!preview || !d) return;
    const t = preview.trial;
    setBusy("Saving…");
    try {
      let res: Response;
      if (t.remove) {
        // Pairs are stored in sorted order, whichever way round they were named.
        const [a, b] = t.rule === "never_weld" ? [t.kind_a, ""] : [t.kind_a, t.kind_b ?? ""].sort();
        const hit = d.rules.find((r) => r.rule === t.rule && r.kind_a === a
                                        && (r.kind_b ?? "") === b);
        if (!hit?.id) { setErr("That rule is not recorded any more"); return; }
        res = await fetch(`${api}/joint-rules/${hit.id}/`, { method: "DELETE" });
      } else {
        res = await fetch(`${api}/joint-rules/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule: t.rule, kind_a: t.kind_a, kind_b: t.kind_b }),
        });
      }
      if (!res.ok) { const b = await res.json().catch(() => ({}));
                     setErr(b?.detail ?? `saving returned ${res.status}`); return; }
      // The piece this page showed is usually a different piece now - its parts changed - so
      // go back to the node, where the new pieces are.
      router.push(nodeHref);
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(null); }
  }

  async function tag(kind: string, t: "bought_out" | "free_issue" | "manufactured") {
    setBusy("Tagging…"); setErr(null); setNote(null);
    try {
      const res = await fetch(`${api}/isolate/tag-kind/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, kind, tag: t }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(b?.detail ?? `tagging returned ${res.status}`); return; }
      setNote(`${b.parts} part${b.parts === 1 ? "" : "s"} in this node tagged ${
        t === "bought_out" ? "bought out" : t === "free_issue" ? "free issue" : "manufactured"}.`);
      setReload((n) => n + 1);
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(null); }
  }

  async function rename() {
    if (!d?.accepted_key || !name.trim()) return;
    setBusy("Renaming…");
    try {
      const res = await fetch(`${api}/isolate/rename/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assembly_key: d.accepted_key, name: name.trim() }),
      });
      if (!res.ok) { setErr(`rename returned ${res.status}`); return; }
      setNote("Renamed."); setReload((n) => n + 1);
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(null); }
  }

  if (gone) {
    return (
      <Warn>
        This piece no longer exists as it was — a rule or a tag has changed what it is made of.{" "}
        <Link href={nodeHref} className="underline">Back to the node</Link> to see the pieces now.
      </Warn>
    );
  }
  if (err && !d) return <Warn>{err}</Warn>;
  if (!d) return <p className="mt-4 text-sm text-slate-500">Opening the piece…</p>;

  const p = d.piece;

  return (
    <div className="mt-2 space-y-4">
      <Link href={nodeHref} className="text-sm text-slate-500 hover:text-slate-800">
        ← back to the node
      </Link>

      <div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{d.accepted?.name || p.label}</h1>
          <p className="text-sm text-slate-600">
            ×{p.qty} in this node · {p.parts} part{p.parts === 1 ? "" : "s"} each ·{" "}
            {p.mass_kg.toFixed(1)} kg each · {p.weld_count} welds inside
            {p.bolted_to > 0 && ` · bolted to ${p.bolted_to} other piece${p.bolted_to === 1 ? "" : "s"}`}
          </p>
          <p className="text-xs text-slate-500">
            Edits in the model below apply to this piece. The rules further down are about a{" "}
            <em>kind</em> of part and apply to all {p.qty} of these at once.
          </p>
          {d.accepted_key && (
            <div className="flex items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)}
                     className="w-64 rounded border border-slate-300 px-2 py-1 text-sm" />
              <button onClick={rename} disabled={!!busy}
                      className="rounded border border-slate-300 px-3 py-1 text-sm">Rename</button>
              {d.accepted?.named_by === "human" && (
                <span className="text-xs text-slate-500">your name — kept when pieces change</span>
              )}
            </div>
          )}
        </div>
      </div>

      {err && <Warn>{err}</Warn>}
      {note && <p className="text-sm text-slate-600">{note}</p>}
      {busy && <p className="text-sm text-slate-500">{busy}</p>}

      <PieceEditor modelId={modelId} prefix={prefix} piece={piece} highlight={lit}
                   panelLabel="Rules by kind" prefer={p.qty > 1 ? "panel" : "joints"}
                   onSaved={(k) => router.push(k ? `/${modelId}/isolate/?${qs}&piece=${k}`
                                                 : nodeHref)}
                   panel={
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            These are rules about a <em>kind</em> of part, so each applies to all {p.qty} pieces
            like this one. Hover a row to see what it would act on in the model.
          </p>
      {preview && (
        <div className="space-y-2 rounded-lg border-2 border-slate-900 bg-white p-4">
          <div className="text-sm font-semibold">{describe(preview.trial, d)}</div>
          <p className="text-sm text-slate-700">
            This piece would become <strong>{preview.becomes_count}</strong>{" "}
            piece{preview.becomes_count === 1 ? "" : "s"}. Across the whole node:{" "}
            <strong>{preview.node_before.pieces.toLocaleString()}</strong> →{" "}
            <strong>{preview.node_after.pieces.toLocaleString()}</strong> pieces, largest{" "}
            {preview.node_before.largest} → {preview.node_after.largest} parts.
          </p>
          <ul className="max-h-48 overflow-y-auto text-xs text-slate-600">
            {preview.becomes.map((b, i) => (
              <li key={i}>
                {b.label} — {b.parts} part{b.parts === 1 ? "" : "s"}
                {b.from_elsewhere > 0 && ` (${b.from_elsewhere} joined from other pieces)`}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button onClick={saveRule} disabled={!!busy}
                    className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
              {preview.trial.remove ? "Remove the rule" : "Save rule"}
            </button>
            <button onClick={() => setPreview(null)}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <Section title="What it is made of">
        {d.parts.map((k) => (
          <Row key={k.kind} onHover={(on) => setLit(on ? { a: k.kind } : null)}
               left={<>
                 <span className="font-medium">{k.name}</span>
                 <span className="ml-2 text-xs text-slate-500">
                   ×{k.qty} · {k.mass_kg.toFixed(1)} kg{k.marks.length ? ` · ${k.marks.join(", ")}` : ""}
                 </span>
                 {k.never_weld && <Pill>always bolted</Pill>}
               </>}
               right={<>
                 {k.never_weld
                   ? <Act onClick={() => tryRule({ rule: "never_weld", kind_a: k.kind, remove: true })}>
                       Allow welds again</Act>
                   : <Act onClick={() => tryRule({ rule: "never_weld", kind_a: k.kind })}
                          title="Parts of this kind are never welded to anything - bolted by role">
                       Always bolted</Act>}
                 {k.supply !== "buy" && <Act onClick={() => tag(k.kind, "bought_out")}>Bought out</Act>}
                 {k.supply !== "free_issue" && <Act onClick={() => tag(k.kind, "free_issue")}>Free issue</Act>}
                 {k.supply !== "make" && <Act onClick={() => tag(k.kind, "manufactured")}>Made</Act>}
               </>} />
        ))}
      </Section>

      <Section title="How it holds together">
        {d.joints_inside.length === 0 && <Empty>One part — nothing joins inside it.</Empty>}
        {d.joints_inside.map((j) => (
          <Row key={`${j.kind_a}|${j.kind_b}|${j.joint}`}
               onHover={(on) => setLit(on ? { a: j.kind_a, b: j.kind_b } : null)}
               left={<>
                 <span className="font-medium">{j.name_a} ↔ {j.name_b}</span>
                 <span className="ml-2 text-xs text-slate-500">
                   {j.joint} · {j.count} joint{j.count === 1 ? "" : "s"}
                   {j.weld_mm ? ` · ${(j.weld_mm / 1000).toFixed(1)} m of weld` : ""}
                 </span>
                 {j.shop && <Pill>shop bolted</Pill>}
               </>}
               right={j.joint === "weld"
                 ? <Act onClick={() => tryRule({ rule: "site", kind_a: j.kind_a, kind_b: j.kind_b })}
                        title="These welds are made on site - the piece splits here">
                     Site weld — split here</Act>
                 : j.shop
                   ? <Act onClick={() => tryRule({ rule: "shop", kind_a: j.kind_a, kind_b: j.kind_b,
                                                   remove: true })}>Undo shop joint</Act>
                   : null} />
        ))}
      </Section>

      <Section title="What it is joined to outside itself">
        {d.joints_out.length === 0 && <Empty>Nothing - it stands alone.</Empty>}
        {d.joints_out.map((j) => (
          <Row key={`${j.kind_a}|${j.kind_b}|${j.joint}`}
               onHover={(on) => setLit(on ? { a: j.kind_a, b: j.kind_b } : null)}
               left={<>
                 <span className="font-medium">{j.name_a} ↔ {j.name_b}</span>
                 <span className="ml-2 text-xs text-slate-500">
                   {j.joint} · {j.count} joint{j.count === 1 ? "" : "s"}
                   {j.bolts ? ` · ${j.bolts} bolts` : ""}
                 </span>
                 {j.site && <Pill>site weld</Pill>}
               </>}
               right={j.joint === "weld" && j.site
                 ? <Act onClick={() => tryRule({ rule: "site", kind_a: j.kind_a, kind_b: j.kind_b,
                                                 remove: true })}>Undo site weld</Act>
                 : j.joint !== "weld"
                   ? <Act onClick={() => tryRule({ rule: "shop", kind_a: j.kind_a, kind_b: j.kind_b })}
                          title="These are bolted in the shop - the pieces arrive as one">
                       Shop bolted — join</Act>
                   : null} />
        ))}
      </Section>
        </div>
      } />
    </div>
  );
}

function describe(t: Rule & { remove?: boolean }, d: Detail): string {
  const nm = (k?: string) => {
    const all = [...d.parts.map((p) => [p.kind, p.name]),
                 ...d.joints_inside.flatMap((j) => [[j.kind_a, j.name_a], [j.kind_b, j.name_b]]),
                 ...d.joints_out.flatMap((j) => [[j.kind_a, j.name_a], [j.kind_b, j.name_b]])];
    return all.find(([kk]) => kk === k)?.[1] ?? k ?? "";
  };
  const what = t.rule === "never_weld" ? `${nm(t.kind_a)} is always bolted, never welded`
    : t.rule === "site" ? `${nm(t.kind_a)} ↔ ${nm(t.kind_b)} welds are made on site`
    : `${nm(t.kind_a)} ↔ ${nm(t.kind_b)} bolts are made in the shop`;
  return t.remove ? `Remove the rule: ${what}` : `New rule: ${what}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {children}
      </ul>
    </section>
  );
}

function Row({ left, right, onHover }: {
  left: React.ReactNode; right: React.ReactNode; onHover?: (on: boolean) => void;
}) {
  return (
    <li onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)}
        className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm
                   hover:bg-amber-50">
      <div className="min-w-0">{left}</div>
      <div className="flex flex-wrap gap-1.5">{right}</div>
    </li>
  );
}

function Act({ onClick, children, title }: {
  onClick: () => void; children: React.ReactNode; title?: string;
}) {
  return (
    <button onClick={onClick} title={title}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
      {children}
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
    {children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-3 py-2 text-xs text-slate-500">{children}</li>;
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      {children}
    </p>
  );
}
