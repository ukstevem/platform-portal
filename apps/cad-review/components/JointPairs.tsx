"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The joints the model gives two answers for (bd s8r8.1).
 *
 * On job 10335's structure, of 263 kind pairs, 33 are recorded BOTH welded and bolted, and those
 * 33 carry 5,290 of the 10,982 welds - 48%. Half the weld graph runs through joints the model
 * contradicts itself about, and those are what fuse pieces into lumps.
 *
 * Thirty-three decisions instead of four thousand pieces. The ORDER is the useful part: PL10 to
 * UC152 is 1,524 welded against 34 bolted and needs a glance; PFC200 to PL10 is 271 against 230
 * and needs a fabricator. Rows are sorted by welds x doubt, so the second sorts above the first.
 *
 * Before taking a rule you can see what it DOES - not "3,895 pieces becomes 4,157", which nobody
 * can picture, but "139 pieces split, the biggest a 38-part beam that becomes 30 and five loose
 * cleats". That can be agreed with or argued with, which is the whole point.
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
  ["site", "Site joint", "made on site, so it does not hold a shop piece together"],
  ["shop", "Shop joint", "made in the shop, so it does hold the piece together"],
  ["never_weld", "Never joined", "these two are not fixed to each other at all"],
];

export function JointPairs({ modelId, prefix, onChanged }: {
  modelId: string; prefix: string; onChanged?: () => void;
}) {
  const [pairs, setPairs] = useState<Pairs | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [effect, setEffect] = useState<Effect | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const api = `/cad-review/api/cad/models/${modelId}`;
  const qs = `prefix=${encodeURIComponent(prefix)}`;
  const key = (r: Row) => `${r.kind_a}|${r.kind_b}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/isolate/joint-pairs/?${qs}`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) { setErr(`joint pairs returned ${res.status}`); return; }
        setPairs(await res.json()); setErr(null);
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, qs, reload]);

  const look = useCallback(async (r: Row, rule = "site") => {
    setOpen(key(r)); setEffect(null); setErr(null);
    try {
      const res = await fetch(`${api}/isolate/joint-pairs/effect/?${qs}`
        + `&kind_a=${encodeURIComponent(r.kind_a)}&kind_b=${encodeURIComponent(r.kind_b)}`
        + `&rule=${rule}`, { cache: "no-store" });
      if (!res.ok) { setErr(`the preview returned ${res.status}`); return; }
      setEffect(await res.json());
    } catch { setErr("Could not reach the CAD service"); }
  }, [api, qs]);

  async function take(r: Row, rule: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/joint-rules/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule, kind_a: r.kind_a,
                               kind_b: rule === "never_weld" ? null : r.kind_b }),
      });
      if (!res.ok) { setErr(`taking the rule returned ${res.status}`); return; }
      setReload((n) => n + 1); setOpen(null); setEffect(null);
      onChanged?.();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  async function drop(r: Row) {
    if (!r.rule) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/joint-rules/${r.rule.id}/`, { method: "DELETE" });
      if (!res.ok) { setErr(`removing the rule returned ${res.status}`); return; }
      setReload((n) => n + 1);
      onChanged?.();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  if (err && !pairs) return <p className="text-sm text-amber-800">{err}</p>;
  if (!pairs) return <p className="text-sm text-slate-500">Reading the joints…</p>;
  if (!pairs.rows.length) {
    return <p className="text-sm text-emerald-800">
      Nothing to settle: the model is consistent about every one of its {pairs.pairs_seen} joint
      pairs.
    </p>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
        <b>{pairs.contradictory}</b> of {pairs.pairs_seen} kind pairs are recorded both welded and
        bolted, and they carry <b>{pairs.welds_in_doubt.toLocaleString()}</b> of the node&apos;s{" "}
        {pairs.welds.toLocaleString()} welds. Settling them is {pairs.contradictory} decisions
        instead of four thousand pieces. Worst first: how much fusing hangs on an answer the model
        is unsure of.
      </div>
      {err && <p className="text-sm text-amber-800">{err}</p>}

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="py-1.5 pr-3">Pair</th>
            <th className="py-1.5 pr-3 text-right">Welded</th>
            <th className="py-1.5 pr-3 text-right">Bolted</th>
            <th className="py-1.5 pr-3">How sure</th>
            <th className="py-1.5 pr-3">Rule</th>
            <th className="py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {pairs.rows.map((r) => {
            const on = open === key(r);
            return (
              <>
                <tr key={key(r)} className={`border-b border-slate-100 ${on ? "bg-sky-50" : ""}`}>
                  <td className="py-1.5 pr-3">{r.kind_a} ↔ {r.kind_b}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.welds.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.bolts.toLocaleString()}</td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded bg-slate-200">
                        <div className={`h-full ${r.doubt > 0.3 ? "bg-amber-500" : "bg-slate-400"}`}
                             style={{ width: `${Math.min(100, r.doubt * 200)}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">
                        mostly {r.mostly}
                      </span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-3">
                    {r.rule ? (
                      <span className="flex items-center gap-1">
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                          {r.rule.rule}</span>
                        <button onClick={() => void drop(r)} disabled={busy}
                                className="text-xs text-slate-400 hover:text-red-700">×</button>
                      </span>
                    ) : <span className="text-xs text-slate-400">not settled</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => (on ? setOpen(null) : void look(r))}
                            className="text-xs text-sky-700 hover:underline">
                      {on ? "close" : "what would it do?"}</button>
                  </td>
                </tr>
                {on && (
                  <tr key={`${key(r)}-effect`} className="border-b border-slate-100 bg-sky-50">
                    <td colSpan={6} className="px-3 py-2">
                      {!effect ? <span className="text-sm text-slate-500">Regrouping…</span> : (
                        <div className="space-y-2 text-sm">
                          <div>
                            Calling this a <b>{effect.rule === "site" ? "site" : effect.rule}</b>{" "}
                            joint splits <b>{effect.splits}</b> pieces
                            ({effect.parts_in_splits} parts), and the node goes from{" "}
                            {effect.before.pieces.toLocaleString()} pieces to{" "}
                            {effect.after.pieces.toLocaleString()}.
                          </div>
                          {effect.examples.length > 0 && (
                            <ul className="space-y-0.5 text-xs text-slate-600">
                              {effect.examples.map((x, n) => (
                                <li key={n} className="tabular-nums">
                                  {x.was} parts → {x.becomes.join(" + ")}
                                  {x.into > x.becomes.length ? " + …" : ""}
                                  <span className="ml-2 text-slate-500">{x.label}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="flex flex-wrap gap-2 pt-1">
                            {RULES.map(([rule, label, why]) => (
                              <button key={rule} onClick={() => void take(r, rule)} disabled={busy}
                                      title={why}
                                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-900 hover:text-white">
                                {label}</button>
                            ))}
                            <button onClick={() => void look(r, effect.rule === "site" ? "shop" : "site")}
                                    className="text-xs text-sky-700 hover:underline">
                              show me the other way</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">
        A <b>site</b> joint is made on site, so it does not hold a shop piece together; a{" "}
        <b>shop</b> joint does. The same pair is legitimately welded in one place and bolted in
        another — the machine proposes, you decide.
      </p>
    </div>
  );
}
