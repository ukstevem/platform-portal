"use client";

import { useCallback, useEffect, useState } from "react";
import { AssemblyViewer } from "./AssemblyViewer";
import { PartViewer } from "./PartViewer";
import { PreparePicturesBar } from "./PreparePictures";
import { Thumb } from "./Thumb";

/**
 * Tag the model top-down: Bought out, or Manufactured and open it up (Steve, 2026-09-21).
 *
 * "rather than the protracted guess on ingest, this tree, or list of items with rendered view
 * is ideal. i could tag a lot of the items as 'bought out' immediately. the others we can has as
 * 'manufactured assemblies' or something similar, those are then exploded to the next level,
 * and we keep going until fully exploded."
 *
 * The loop is his; the pictures are what make it fast. Every tag is RECORDED at once and does
 * not produce — a full run on job 10335 is a 722 MB re-read and 21 minutes, and he makes thirty
 * decisions in a sitting. "Apply & produce" runs it once, when he is done.
 *
 * FOUR KINDS OF ROW, because a model contains all of them:
 *   assembly  — an arrangement of parts; decided by its assembly key
 *   part      — ONE part holding many solids (a weldment, or an exporter's flattened block);
 *               decided at part level, since it has no arrangement of its own
 *   exploded  — a part already split; opens onto GROUPS of its members, because a flattened
 *               export has no sub-assemblies left to walk. Job 10335's whole structure is one
 *               of these: 13,839 unnamed solids, 1,876 shapes, 47 groups.
 *   single    — one part, one solid: the only question is whether it is bought.
 *
 * Earlier versions got single parts wrong twice ("why would i click 'keep whole' it already
 * is", "i cant be anything but whole?") — the kind decides which question is asked.
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
  solids: number;
  part_name: string | null;
  part_key: string | null;          // multi-solid part: decided at part level
  proto_key: string | null;         // the one prototype a single-part row stands for
  exploded: boolean;                // a part already split — opens onto groups
};

type Group = {
  key: string;
  label: string;
  class: string;
  designation: string;
  shapes: number;
  pieces: number;
  mass_kg: number;
  confirmed: number;
  rep: string | null;
  status: "manufactured" | "bought_out" | "free_issue" | "excluded";
};

type Level = {
  prefix: string | null; children: Node[]; total_leaves: number;
  child_count: number; capped: boolean; skipped_wrappers?: number;
};

type Tag = "bought_out" | "manufactured" | "free_issue";
type Sel = { kind: "node"; node: Node } | { kind: "group"; group: Group } | null;

const kindOf = (n: Node) =>
  n.exploded ? "exploded"
  : n.part_key ? "part"
  : (n.assembly_key && (n.leaves > 1 || (n.solids ?? 0) > 1)) ? "assembly"
  : "single";

export function ScopeTree({ modelId, onChanged }: {
  modelId: string; onChanged: () => void;
}) {
  const [root, setRoot] = useState<Level | null>(null);
  // Children and groups are fetched only when a row is first opened — nothing below a closed
  // node is ever loaded, which is what keeps a 15,000-part model tractable.
  const [kids, setKids] = useState<Record<string, Node[]>>({});
  const [groups, setGroups] = useState<Record<string, Group[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Sel>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [applying, setApplying] = useState<string | null>(null);
  // Pictures the service has not prepared (bd jj0p). It will not parse a model's file just to
  // draw one - on job 10335 that stalled everything for four minutes - so a model ingested
  // before pictures were prepared at ingest says "not ready" until someone asks for them.
  const [picsMissing, setPicsMissing] = useState(false);
  const [picsVersion, setPicsVersion] = useState(0);
  const onPicsMissing = useCallback(() => setPicsMissing(true), []);

  const api = `/cad-review/api/cad/models/${modelId}`;

  const fetchLevel = useCallback(async (prefix: string | null): Promise<Level | null> => {
    const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    const res = await fetch(`${api}/tree/${q}`, { cache: "no-store" });
    if (!res.ok) { setErr(`tree returned ${res.status}`); return null; }
    return res.json();
  }, [api]);

  const fetchGroups = useCallback(async (partKey: string): Promise<Group[] | null> => {
    const res = await fetch(`${api}/part-groups/${partKey}/`, { cache: "no-store" });
    if (!res.ok) { setErr(`part-groups returned ${res.status}`); return null; }
    return (await res.json()).groups;
  }, [api]);

  const loadRoot = useCallback(async () => {
    setErr(null);
    try { setRoot(await fetchLevel(null)); }
    catch { setErr("Could not reach the CAD service"); }
  }, [fetchLevel]);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  async function toggle(n: Node) {
    const id = n.exploded ? `g:${n.part_key}` : n.instance_prefix;
    const next = new Set(open);
    if (next.has(id)) { next.delete(id); setOpen(next); return; }
    next.add(id); setOpen(next);
    const have = n.exploded ? groups[n.part_key!] : kids[n.instance_prefix];
    if (have) return;
    setLoading((s) => new Set(s).add(id));
    try {
      if (n.exploded && n.part_key) {
        const g = await fetchGroups(n.part_key);
        if (g) setGroups((m) => ({ ...m, [n.part_key!]: g }));
      } else {
        const lvl = await fetchLevel(n.instance_prefix);
        if (lvl) setKids((k) => ({ ...k, [n.instance_prefix]: lvl.children }));
      }
    } finally {
      setLoading((s) => { const t = new Set(s); t.delete(id); return t; });
    }
  }

  /** Re-read everything on screen after a tag, so no row shows a stale answer. */
  async function refreshOpen() {
    const k: Record<string, Node[]> = {};
    const g: Record<string, Group[]> = {};
    for (const id of open) {
      if (id.startsWith("g:")) {
        const got = await fetchGroups(id.slice(2));
        if (got) g[id.slice(2)] = got;
      } else {
        const lvl = await fetchLevel(id);
        if (lvl) k[id] = lvl.children;
      }
    }
    setKids(k); setGroups(g);
    await loadRoot();
  }

  async function tag(n: Node, t: Tag) {
    setBusy(n.instance_prefix); setErr(null);
    try {
      const kind = kindOf(n);
      let res: Response;
      if (kind === "assembly") {
        // Bought out and free issue are both "kept whole" - the difference is who supplies it.
        res = await fetch(`${api}/scope/unit/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assembly_key: n.assembly_key, designation: n.name,
                                 treatment: t === "manufactured" ? "explode" : "unit",
                                 make_or_buy: t === "free_issue" ? "free_issue" : "buy",
                                 rescope: false }),
        });
      } else if (kind === "part") {
        res = await fetch(`${api}/scope/part/${n.part_key}/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ treatment: t === "manufactured" ? "explode"
                                          : t === "free_issue" ? "free_issue" : "keep_whole" }),
        });
        // Manufactured means split it now, so its members can be tagged on the next level.
        if (res.ok && t === "manufactured") {
          res = await fetch(`${api}/explode/${n.part_key}/`, { method: "POST" });
        }
      } else {
        res = await fetch(`${api}/review/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint_key: n.proto_key,
                                 type: t === "free_issue" ? "FREE_ISSUE" : "BOUGHT_OUT" }),
        });
      }
      if (!res.ok) { setErr(`tagging returned ${res.status}`); return; }
      setPending((p) => p + 1);
      await refreshOpen();
      onChanged();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(null); }
  }

  async function tagGroup(partKey: string, g: Group, t: Tag) {
    setBusy(`g:${partKey}:${g.key}`); setErr(null);
    try {
      const res = await fetch(`${api}/part-groups/${partKey}/tag/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: g.key, tag: t }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body?.detail ?? `tagging returned ${res.status}`); return;
      }
      setPending((p) => p + 1);
      const fresh = await fetchGroups(partKey);
      if (fresh) setGroups((m) => ({ ...m, [partKey]: fresh }));
      onChanged();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(null); }
  }

  async function apply() {
    setApplying("Starting…"); setErr(null);
    try {
      const res = await fetch(`${api}/rescope/`, { method: "POST" });
      if (!res.ok) { setErr(`apply returned ${res.status}`); return; }
      const { job_id } = await res.json();
      if (job_id) await waitFor(job_id, setApplying);
      setPending(0);
      await refreshOpen();
      onChanged();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setApplying(null); }
  }

  if (!root) return err ? <Warn>{err}</Warn>
                        : <p className="text-sm text-slate-500">Reading the assembly tree…</p>;

  const shared = { kids, groups, open, loading, sel, busy, setSel, toggle, tag, tagGroup, modelId,
                   picsVersion, onPicsMissing };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {root.child_count} top-level node{root.child_count === 1 ? "" : "s"} ·{" "}
          {root.total_leaves} parts. Tag each <strong>Bought out</strong> or{" "}
          <strong>Manufactured</strong>; open a manufactured one to tag what is inside it.
        </p>
        {/* Tags record instantly and do not produce: one pass at the end, not one per click. */}
        {(pending > 0 || applying) && (
          <div className="flex items-center gap-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm">
            {applying ? (
              <>
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-900" />
                <span className="text-slate-700">Applying — {applying}</span>
              </>
            ) : (
              <>
                <span className="text-slate-700">
                  {pending} tag{pending === 1 ? "" : "s"} recorded — cut files update when applied
                </span>
                <button onClick={apply}
                        className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
                  Apply &amp; produce
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {err && <Warn>{err}</Warn>}

      {picsMissing && (
        <PreparePicturesBar modelId={modelId} onDone={() => {
          setPicsMissing(false);
          setPicsVersion((v) => v + 1);         // remount every picture, so each asks again
        }} />
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="self-start rounded-lg border border-slate-200 bg-white">
          <ul>
            {root.children.map((n) => (
              <Row key={n.instance_prefix} n={n} depth={0} {...shared} />
            ))}
          </ul>
          {root.capped && (
            <p className="px-4 py-2 text-xs text-amber-700">
              Only the largest {root.children.length} of {root.child_count} shown — the rest carry
              less work.
            </p>
          )}
        </div>

        <div className="order-first md:order-none md:self-start md:sticky md:top-4
                        h-[26rem] md:h-[calc(100vh-12rem)] md:max-h-[36rem] md:overflow-y-auto">
          {sel?.kind === "group" ? (
            <PartViewer modelId={modelId} fingerprintKey={sel.group.rep} />
          ) : (
            <AssemblyViewer modelId={modelId}
                            prefix={sel?.kind === "node" ? sel.node.instance_prefix : null}
                            className="h-full" />
          )}
        </div>
      </div>
    </div>
  );
}

type Shared = {
  kids: Record<string, Node[]>; groups: Record<string, Group[]>;
  open: Set<string>; loading: Set<string>; sel: Sel; busy: string | null;
  setSel: (s: Sel) => void;
  toggle: (n: Node) => void;
  tag: (n: Node, t: Tag) => void;
  tagGroup: (partKey: string, g: Group, t: Tag) => void;
  modelId: string;
  picsVersion: number;
  onPicsMissing: () => void;
};

function Row({ n, depth, ...s }: { n: Node; depth: number } & Shared) {
  const kind = kindOf(n);
  const id = n.exploded ? `g:${n.part_key}` : n.instance_prefix;
  const isOpen = s.open.has(id);
  const working = !!s.busy;
  const selected = s.sel?.kind === "node" && s.sel.node.instance_prefix === n.instance_prefix;
  const bought = n.decision === "unit";
  const made = n.decision === "explode";
  const free = n.decision === "free_issue";
  const current: Tag | null = bought ? "bought_out" : made ? "manufactured" : free ? "free_issue" : null;
  // Which tags make sense for this KIND. A single solid part has nothing to open, so the only
  // question is who supplies it. An exploded part is answered by its members.
  const options: Tag[] = kind === "exploded" ? []
    : kind === "single" ? ["bought_out", "free_issue"]
    : ["bought_out", "free_issue", "manufactured"];

  return (
    <li>
      <div onClick={() => s.setSel({ kind: "node", node: n })}
           style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
           className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-l-4 py-2 pr-3
             transition ${selected ? "border-l-slate-900 bg-slate-100"
               : "border-l-transparent hover:border-l-slate-300 hover:bg-slate-50"}`}>

        {!n.is_leaf ? (
          <button onClick={(e) => { e.stopPropagation(); s.toggle(n); }}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${n.name ?? n.node}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-base
                             leading-none text-slate-600 hover:bg-slate-200 hover:text-slate-900">
            {s.loading.has(id) ? <span className="animate-pulse">·</span> : isOpen ? "▾" : "▸"}
          </button>
        ) : <span className="h-8 w-8 shrink-0" />}

        {/* Every level, not just the top: a name deep in a client model means no more than
            one at the top does (bd jj0p). */}
        <Thumb key={s.picsVersion} onNotReady={s.onPicsMissing}
               src={`/cad-review/api/cad/models/${s.modelId}/node-thumbnail/?prefix=${
                  encodeURIComponent(n.instance_prefix)}`}
               className={depth === 0 ? "h-[52px] w-[76px]" : "h-[44px] w-[64px]"} />

        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">
            {n.name || <span className="font-mono text-slate-500">{n.node}</span>}
          </span>
          {n.part_name && n.part_name !== n.name && (
            <span className="ml-2 font-mono text-xs text-slate-500">{n.part_name}</span>
          )}
          <span className="ml-2 text-xs tabular-nums text-slate-500">
            {n.exploded
              ? `${(n.solids ?? 0).toLocaleString()} solids · flattened on export`
              : `${n.leaves} part${n.leaves === 1 ? "" : "s"}${
                  (n.solids ?? 0) > 1 && n.leaves <= 1 ? ` · ${n.solids} solids` : ""}`}
          </span>
          {bought && <Pill tone="buy">bought out</Pill>}
          {free && <Pill tone="free">free issue</Pill>}
          {made && <Pill tone="make">{n.exploded ? "manufactured · exploded" : "manufactured"}</Pill>}
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {options.filter((t) => t !== current).map((t) => (
            <TagButton key={t} t={t} changing={!!current}
                       disabled={working || (kind === "single" ? !n.proto_key
                                 : kind === "assembly" ? !n.assembly_key : false)}
                       busy={s.busy === n.instance_prefix}
                       onClick={() => s.tag(n, t)} />
          ))}
        </div>
      </div>

      {isOpen && n.exploded && n.part_key && s.groups[n.part_key] && (
        <ul className="border-t border-slate-100">
          {s.groups[n.part_key].map((g) => (
            <GroupRow key={g.key} g={g} partKey={n.part_key!} depth={depth + 1} {...s} />
          ))}
        </ul>
      )}
      {isOpen && !n.exploded && s.kids[n.instance_prefix] && (
        <ul className="border-t border-slate-100">
          {s.kids[n.instance_prefix].map((c) => (
            <Row key={c.instance_prefix} n={c} depth={depth + 1} {...s} />
          ))}
          {s.kids[n.instance_prefix].length === 0 && (
            <li style={{ paddingLeft: `${(depth + 1) * 1.5 + 2.5}rem` }}
                className="py-1.5 text-xs text-slate-400">nothing below this</li>
          )}
        </ul>
      )}
    </li>
  );
}

function GroupRow({ g, partKey, depth, ...s }:
                  { g: Group; partKey: string; depth: number } & Shared) {
  const id = `g:${partKey}:${g.key}`;
  const selected = s.sel?.kind === "group" && s.sel.group.key === g.key;
  // "From before" when every member was already decided — a revision or repeat equipment.
  // Otherwise it is identify's suggestion, shown as such, for a person to confirm.
  const decided = g.confirmed >= g.shapes && g.shapes > 0;
  const tone = g.status === "bought_out" ? "buy" : g.status === "manufactured" ? "make"
             : g.status === "free_issue" ? "free" : "exc";

  return (
    <li>
      <div onClick={() => s.setSel({ kind: "group", group: g })}
           style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
           className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-l-4 py-1.5 pr-3
             transition ${selected ? "border-l-slate-900 bg-slate-100"
               : "border-l-transparent hover:border-l-slate-300 hover:bg-slate-50"}`}>
        <span className="h-8 w-8 shrink-0" />
        {g.rep ? (
          <Thumb key={s.picsVersion} onNotReady={s.onPicsMissing}
                 src={`/cad-review/api/cad/models/${s.modelId}/prototype/${g.rep}/thumbnail/`}
                 className="h-[44px] w-[64px]" />
        ) : <span className="h-[44px] w-[64px] shrink-0 rounded bg-slate-100" />}

        <div className="min-w-0 flex-1">
          <span className="font-mono text-sm">{g.label}</span>
          <span className="ml-2 text-xs tabular-nums text-slate-500">
            {g.pieces.toLocaleString()} pcs · {g.shapes} shape{g.shapes === 1 ? "" : "s"} ·{" "}
            {(g.mass_kg / 1000).toFixed(1)} t
          </span>
          <Pill tone={tone}>
            {g.status === "bought_out" ? "bought out"
              : g.status === "free_issue" ? "free issue" : g.status}
          </Pill>
          <span className={`ml-1 text-xs ${decided ? "text-slate-500" : "text-amber-700"}`}>
            {decided ? "from before" : "suggested"}
          </span>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* All shown until a person decides; after that, only the changes. */}
          {(["bought_out", "free_issue", "manufactured"] as Tag[])
            .filter((t) => !decided || t !== g.status)
            .map((t) => (
              <TagButton key={t} t={t} small changing={decided} disabled={!!s.busy}
                         busy={s.busy === id} onClick={() => s.tagGroup(partKey, g, t)} />
            ))}
        </div>
      </div>
    </li>
  );
}

const TAG_LABEL: Record<Tag, string> = {
  bought_out: "Bought out", free_issue: "Free issue", manufactured: "Manufactured",
};
const TAG_TITLE: Record<Tag, string> = {
  bought_out: "We buy this - one line on the BOM, nothing inside it is looked at",
  free_issue: "The client supplies this - fitted, never bought or cut, and not priced",
  manufactured: "We make this - open it up and tag what is inside",
};

function TagButton({ t, changing, disabled, busy, onClick, small }: {
  t: Tag; changing: boolean; disabled: boolean; busy: boolean; onClick: () => void;
  small?: boolean;
}) {
  const size = small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const look = t === "bought_out" ? "bg-slate-900 text-white"
             : t === "free_issue" ? "border border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100"
             : "border border-slate-300 text-slate-700 hover:bg-slate-50";
  return (
    <button disabled={disabled} onClick={onClick} title={TAG_TITLE[t]}
            className={`rounded ${size} ${look} disabled:opacity-40`}>
      {busy ? "Recording…" : `${TAG_LABEL[t]}${changing ? " instead" : ""}`}
    </button>
  );
}

function Pill({ tone, children }: { tone: "buy" | "make" | "free" | "exc"; children: React.ReactNode }) {
  const c = tone === "buy" ? "bg-emerald-100 text-emerald-800"
          : tone === "make" ? "bg-sky-100 text-sky-800"
          : tone === "free" ? "bg-violet-100 text-violet-800"
          : "bg-slate-200 text-slate-600";
  return <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${c}`}>{children}</span>;
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </p>
  );
}

async function waitFor(jobId: string, note: (s: string) => void, tries = 1440) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const res = await fetch(`/cad-review/api/cad/jobs/${jobId}/`, { cache: "no-store" });
      if (!res.ok) continue;
      const j = await res.json();
      if (j.status === "done" || j.status === "completed") {
        if (j.result?.produce_job_id) {
          note("producing cut files…");
          return waitFor(j.result.produce_job_id, note, tries);
        }
        return;
      }
      if (j.status === "failed" || j.status === "error") { note("failed"); return; }
      if (j.phase) note(`${j.phase}…`);
    } catch { return; }
  }
}
