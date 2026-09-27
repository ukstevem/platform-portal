"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Settle the joints the model gives two answers for, ONE AT A TIME (bd s8r8.1).
 *
 * On job 10335's structure, of 263 kind pairs, 33 are recorded BOTH welded and bolted, and those
 * 33 carry 5,290 of the 10,982 welds - 48%. Half the weld graph runs through joints the model
 * contradicts itself about, and those are what fuse pieces into lumps.
 *
 * The first version of this was a table with the evidence and a preview behind an expander. Steve,
 * 2026-09-27: "the 'joints' is of little use, i see the table and the extended information under
 * 'what does it do' which is great, but it doesnt provide a step to cleaning the data or
 * progressing the task for the user." Quite right: a table is a reference, not a piece of work. So
 * this is the shape that worked for the levels - one at a time, everything needed to decide
 * already on screen, a decision, and the next one - with the table kept underneath for looking
 * things up and jumping about.
 *
 * The ORDER is what makes it a short job: welds x doubt, so a pair with 271 welds and 46% doubt
 * comes before one with 1,524 welds and 2%. A glance versus a fabricator.
 */

type Row = {
  kind_a: string; kind_b: string; welds: number; bolts: number; contacts: number;
  doubt: number; at_stake: number; mostly: "welded" | "bolted";
  rule: { id: number; rule: string; note: string | null } | null;
};
type Pairs = {
  pairs_seen: number; contradictory: number; welds: number; welds_in_doubt: number; rows: Row[];
};
type Effect = {
  kind_a: string; kind_b: string; rule: string;
  before: { pieces: number; largest: number; over_30: number };
  after: { pieces: number; largest: number; over_30: number };
  splits: number; parts_in_splits: number;
  examples: { label: string; was: number; becomes: number[]; into: number }[];
};

const RULES: [string, string, string][] = [
  ["site", "Made on site", "so it does not hold a shop piece together"],
  ["shop", "Made in the shop", "so it does hold the piece together"],
  ["never_weld", "Not joined at all", "these two are not fixed to each other"],
];
const SAID: Record<string, string> = {
  site: "site", shop: "shop", never_weld: "not joined",
};

export function JointPairs({ modelId, prefix, onChanged }: {
  modelId: string; prefix: string; onChanged?: () => void;
}) {
  const [pairs, setPairs] = useState<Pairs | null>(null);
  const [at, setAt] = useState(0);
  const [rule, setRule] = useState<"site" | "shop">("site");
  const [effect, setEffect] = useState<Effect | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const cache = useRef<Map<string, Effect>>(new Map());
  const pics = useRef<Map<string, string | "none" | "unprepared">>(new Map());
  const [shot, setShot] = useState<{ where?: string; loose?: string; state: string }>(
    { state: "drawing" });

  const api = `/cad-review/api/cad/models/${modelId}`;
  const qs = `prefix=${encodeURIComponent(prefix)}`;
  const key = (r: Row) => `${r.kind_a}|${r.kind_b}`;

  /** What the service said, not just the number - a status code alone is not actionable. */
  const why = useCallback(async (res: Response, what: string) => {
    let detail = "";
    try {
      const body = await res.json();
      detail = [body?.detail, body?.ref ? `(ref ${body.ref})` : ""].filter(Boolean).join(" ");
    } catch { /* not json: the status is all there is */ }
    return `${what} returned ${res.status}${detail ? ` — ${detail}` : ""}`;
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/isolate/joint-pairs/?${qs}`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) { setErr(await why(res, "joint pairs")); return; }
        setPairs(await res.json()); setErr(null);
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, qs, reload, why]);

  const rows = pairs?.rows ?? [];
  const row = rows[at];
  const settled = rows.filter((r) => r.rule).length;
  const todo = useMemo(
    () => rows.filter((r) => !r.rule && !skipped.has(key(r))), [rows, skipped]);

  const load = useCallback(async (r: Row, want: string): Promise<Effect | null> => {
    const k = `${key(r)}|${want}`;
    const had = cache.current.get(k);
    if (had) return had;
    const res = await fetch(`${api}/isolate/joint-pairs/effect/?${qs}`
      + `&kind_a=${encodeURIComponent(r.kind_a)}&kind_b=${encodeURIComponent(r.kind_b)}`
      + `&rule=${want}`, { cache: "no-store" });
    if (!res.ok) { setErr(await why(res, "the preview")); return null; }
    const body: Effect = await res.json();
    cache.current.set(k, body);
    return body;
  }, [api, qs, why]);

  /**
   * The pair drawn IN THE BUILDING. Steve, 2026-09-27, after two attempts in words and numbers:
   * "i still cant interpret the results from 'joints'... we need a 3d representation." Quite
   * right - "271 welded, 230 bolted" is a fact about a spreadsheet. Seeing the stair stringers
   * light up with their cleats is what tells a fabricator what the pair actually IS.
   */
  const picture = useCallback(async (r: Row, what: "where" | "loose", want: string) => {
    const k = `${key(r)}|${what}|${what === "loose" ? want : ""}`;
    const had = pics.current.get(k);
    if (had) return had;
    const res = await fetch(`${api}/isolate/joint-pairs/picture/?${qs}`
      + `&kind_a=${encodeURIComponent(r.kind_a)}&kind_b=${encodeURIComponent(r.kind_b)}`
      + `&what=${what}&rule=${want}`);
    let got: string | "none" | "unprepared";
    if (res.status === 202) got = "unprepared";
    else if (res.status === 204 || !res.ok) got = "none";
    else got = URL.createObjectURL(await res.blob());
    pics.current.set(k, got);
    return got;
  }, [api, qs]);

  useEffect(() => {
    let live = true;
    if (!row) { setShot({ state: "none" }); return; }
    setShot({ state: "drawing" });
    (async () => {
      const where = await picture(row, "where", rule);
      if (!live) return;
      setShot((cur) => ({ ...cur, where: where.startsWith("blob") ? where : undefined,
                          state: where === "unprepared" ? "unprepared" : "ready" }));
      const loose = await picture(row, "loose", rule);
      if (!live) return;
      setShot((cur) => ({ ...cur, loose: loose.startsWith("blob") ? loose : undefined }));
      const next = rows[at + 1];               // draw the next one while this is being read
      if (next) void picture(next, "where", rule);
    })();
    return () => { live = false; };
  }, [row, rows, at, rule, picture]);

  useEffect(() => {
    let live = true;
    if (!row) return;
    setEffect(null);
    (async () => {
      const got = await load(row, rule);
      if (!live) return;
      setEffect(got);
      const next = rows[at + 1];               // work out the next one while this is being read
      if (next) void load(next, rule);
    })();
    return () => { live = false; };
  }, [row, rows, at, rule, load]);

  function advance() {
    const next = rows.findIndex((r, n) => n > at && !r.rule && !skipped.has(key(r)));
    setAt(next >= 0 ? next : Math.min(at + 1, rows.length - 1));
  }

  async function take(r: Row, want: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/joint-rules/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule: want, kind_a: r.kind_a,
                               kind_b: want === "never_weld" ? null : r.kind_b }),
      });
      if (!res.ok) { setErr(await why(res, "taking the rule")); return; }
      cache.current.clear();                   // every preview is now measured against new rules
      pics.current.clear();
      setReload((n) => n + 1);
      advance();
      onChanged?.();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  async function drop(r: Row) {
    if (!r.rule) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/joint-rules/${r.rule.id}/`, { method: "DELETE" });
      if (!res.ok) { setErr(await why(res, "removing the rule")); return; }
      cache.current.clear();
      setReload((n) => n + 1);
      onChanged?.();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  if (err && !pairs) return <p className="text-sm text-amber-800">{err}</p>;
  if (!pairs) return <p className="text-sm text-slate-500">Reading the joints…</p>;
  if (!rows.length) {
    return <p className="text-sm text-emerald-800">
      Nothing to settle: the model is consistent about every one of its {pairs.pairs_seen} joint
      pairs.
    </p>;
  }

  const done = todo.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">
          {settled} of {rows.length} settled
        </span>
        <div className="h-1.5 w-40 overflow-hidden rounded bg-slate-200">
          <div className="h-full bg-slate-900"
               style={{ width: `${(settled / rows.length) * 100}%` }} />
        </div>
        <span className="text-slate-500">
          {skipped.size > 0 && `${skipped.size} left for now · `}
          these {rows.length} carry {pairs.welds_in_doubt.toLocaleString()} of the node&apos;s{" "}
          {pairs.welds.toLocaleString()} welds
        </span>
        {err && <span className="text-amber-800">{err}</span>}
      </div>

      {done ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm">
          <b>Every pair is settled.</b> The joints now say one thing each, so the pieces below are
          what the model actually means. Nothing here is permanent — take a rule off any row in the
          table and it goes back to being a question.
        </div>
      ) : row && (
        <div className="rounded-lg border border-slate-300 p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-lg font-semibold">{row.kind_a} ↔ {row.kind_b}</span>
            <span className="text-sm text-slate-500">
              recorded <b>{row.welds.toLocaleString()}</b> times welded and{" "}
              <b>{row.bolts.toLocaleString()}</b> times bolted
            </span>
            <span className={`rounded px-2 py-0.5 text-xs ${row.doubt > 0.3
              ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
              {Math.round(row.doubt * 100)}% disagree — mostly {row.mostly}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-4">
            <figure className="space-y-1">
              <figcaption className="text-xs uppercase tracking-wide text-slate-500">
                Where this pair is
              </figcaption>
              <div className="flex h-[380px] w-[560px] items-center justify-center rounded border border-slate-200 bg-white">
                {shot.where
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={shot.where} alt="where this pair is" width={560} height={380} />
                  : <span className="text-sm text-slate-500">
                      {shot.state === "unprepared"
                        ? "The model's surfaces are not prepared yet — prepare the pictures on the Pieces tab."
                        : shot.state === "drawing" ? "Drawing…" : "Nothing to draw."}
                    </span>}
              </div>
            </figure>
            <figure className="space-y-1">
              <figcaption className="text-xs uppercase tracking-wide text-slate-500">
                What comes loose if {rule === "site" ? "made on site" : "made in the shop"}
              </figcaption>
              <div className="flex h-[380px] w-[560px] items-center justify-center rounded border border-slate-200 bg-white">
                {shot.loose
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={shot.loose} alt="what comes loose" width={560} height={380} />
                  : <span className="text-sm text-slate-500">
                      {shot.state === "drawing" ? "Working it out…" : "Nothing comes loose."}
                    </span>}
              </div>
            </figure>
          </div>

          <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
            {!effect ? <span className="text-slate-500">Working out what it would do…</span> : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span>If this is</span>
                  {(["site", "shop"] as const).map((r2) => (
                    <button key={r2} onClick={() => setRule(r2)}
                            className={`rounded border px-2 py-0.5 text-xs ${rule === r2
                              ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}>
                      {r2 === "site" ? "made on site" : "made in the shop"}</button>
                  ))}
                  <span>
                    : <b>{effect.splits}</b> pieces split ({effect.parts_in_splits} parts), the
                    node goes {effect.before.pieces.toLocaleString()} →{" "}
                    {effect.after.pieces.toLocaleString()} pieces
                    {effect.after.over_30 !== effect.before.over_30 &&
                      `, big pieces ${effect.before.over_30} → ${effect.after.over_30}`}
                  </span>
                </div>
                {effect.examples.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {effect.examples.slice(0, 4).map((x, n) => (
                      <li key={n} className="tabular-nums">
                        {x.was} parts → {x.becomes.join(" + ")}
                        {x.into > x.becomes.length ? " + …" : ""}
                        <span className="ml-2 text-slate-500">{x.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {RULES.map(([r2, label, why2]) => (
              <button key={r2} onClick={() => void take(row, r2)} disabled={busy || !effect}
                      title={why2}
                      className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
                {label}</button>
            ))}
            <button onClick={() => { setSkipped((s) => new Set([...s, key(row)])); advance(); }}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              Leave it for now</button>
            <span className="ml-auto text-xs text-slate-500">
              {todo.length} still to decide
            </span>
          </div>
        </div>
      )}

      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">
          All {rows.length} pairs — click one to go to it
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-1.5 pr-3">Pair</th>
              <th className="py-1.5 pr-3 text-right">Welded</th>
              <th className="py-1.5 pr-3 text-right">Bolted</th>
              <th className="py-1.5 pr-3 text-right">Disagree</th>
              <th className="py-1.5 pr-3">Settled as</th>
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, n) => (
              <tr key={key(r)}
                  className={`border-b border-slate-100 ${n === at ? "bg-sky-50" : ""}`}>
                <td className="py-1 pr-3">
                  <button onClick={() => setAt(n)} className="hover:underline">
                    {r.kind_a} ↔ {r.kind_b}</button>
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{r.welds.toLocaleString()}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{r.bolts.toLocaleString()}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {Math.round(r.doubt * 100)}%</td>
                <td className="py-1 pr-3">
                  {r.rule
                    ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                        {SAID[r.rule.rule] ?? r.rule.rule}</span>
                    : skipped.has(key(r))
                      ? <span className="text-xs text-slate-400">left for now</span>
                      : <span className="text-xs text-slate-400">—</span>}
                </td>
                <td className="py-1 text-right">
                  {r.rule && (
                    <button onClick={() => void drop(r)} disabled={busy}
                            title="make it a question again"
                            className="px-1 text-slate-400 hover:text-red-700">×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="text-xs text-slate-500">
        The same pair is legitimately welded in one place and bolted in another — the machine
        proposes, you decide. A joint made <b>on site</b> does not hold a shop piece together; one
        made <b>in the shop</b> does.
      </p>
    </div>
  );
}
