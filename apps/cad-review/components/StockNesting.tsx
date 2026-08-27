"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Stock lengths, and the nest — the back door.
 *
 * This was the last step that still needed an agent. Everything else — ingest, scope, review,
 * cut files — a user can now do alone; the cut list could not be got out without someone
 * building a payload, posting to the Orin and rendering a workbook.
 *
 * PRE-FILLED 12200 x 100, at Steve's instruction. 12200 is the standard UK merchant length,
 * and a generous bar count means the solver is never stock-starved: it reports how many bars
 * are ACTUALLY needed rather than being capped by a guess. Both are editable per section,
 * which is the point — last week's job ran against real stock (CHS 88.9 at 12200, UC 254 at
 * 15500) and a nest is only as good as the bars you tell it about.
 *
 * THE LONGEST PIECE IS SHOWN BESIDE THE BAR. A bar shorter than the longest piece cannot cut
 * it, and that is worth saying BEFORE the solve rather than leaving it to surface afterwards
 * as an unplaced item — the recurring fault in this pipeline has been a correct detection
 * that nothing downstream consulted.
 */

type Group = {
  designation: string;
  pieces: number;
  total_length_mm: number;
  longest_mm: number;
  provisional: boolean;
};
type Item = { item_index?: number; section: string; length: number;
              ref_id?: string; member_name?: string; parent?: string };
type Input = {
  ready: boolean;
  by_designation: Group[];
  items: Item[];
  excluded?: { designation: string; reason: string }[];
};
type Stock = { length: string; qty: string };
/** What /cutting-list actually returns — totals + per-section, NOT a flat bar list. */
type Result = {
  job_label?: string;
  totals?: {
    sections_processed: number; total_stocks_used: number; total_waste_mm: number;
    total_items_placed: number; total_items_unassigned: number;
  };
  sections?: {
    designation: string; items_placed: number; items_unassigned: number;
    summary?: { stocks_used?: number };
  }[];
};

const DEFAULT_LENGTH = "12200";   // standard UK merchant length
const DEFAULT_QTY = "100";        // deliberately generous: let the solver report the need

export function StockNesting({ modelId, projectRef }: {
  modelId: string; projectRef?: string | null;
}) {
  const [input, setInput] = useState<Input | null>(null);
  const [stock, setStock] = useState<Record<string, Stock>>({});
  const [kerf, setKerf] = useState("3");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/nesting-input/`,
                              { cache: "no-store" });
      if (!res.ok) { setErr(`nesting-input returned ${res.status}`); return; }
      const data: Input = await res.json();
      setInput(data);
      setStock(Object.fromEntries((data.by_designation ?? []).map((g) => [
        g.designation, { length: DEFAULT_LENGTH, qty: DEFAULT_QTY },
      ])));
    } catch { setErr("Could not reach the CAD service"); }
  }, [modelId]);

  useEffect(() => { load(); }, [load]);

  function set(desig: string, field: keyof Stock, value: string) {
    setStock((s) => ({ ...s, [desig]: { ...s[desig], [field]: value } }));
  }

  const barFor = (d: string) => Number(stock[d]?.length) || 0;
  const short = (input?.by_designation ?? []).filter(
    (g) => barFor(g.designation) > 0 && g.longest_mm > barFor(g.designation));

  async function nest() {
    if (!input) return;
    setBusy(true); setErr(null); setResult(null); setPhase("Sending to the nesting service…");
    try {
      // The service wants ONE ROW PER PIECE, which is exactly what nesting-input already
      // emits — so the items are passed straight through rather than grouped into
      // length+qty. That is not just less code: each item carries ref_id, member_name and
      // parent, and those are what make the returned cut list say WHICH beam each cut is.
      // Grouping would collapse them and hand back the anonymous list Steve could not read:
      // "I cant identify which beam is which".
      const items = (input.items ?? []).map((it, i) => ({
        ...it,
        item_index: it.item_index ?? i,
        length: Math.round(it.length),
      }));

      const stock_per_section = (input.by_designation ?? []).map((g) => {
        const s = stock[g.designation] ?? { length: DEFAULT_LENGTH, qty: DEFAULT_QTY };
        return {
          section: g.designation,
          stock: [{ length: parseInt(s.length, 10) || 0, qty: parseInt(s.qty, 10) || 0 }],
        };
      }).filter((s) => s.stock[0].length > 0 && s.stock[0].qty > 0);

      if (items.length === 0) { setErr("There is nothing to nest."); return; }

      const payload = {
        job_label: projectRef ? `${projectRef} - CAD review` : "CAD review",
        items,
        stock_per_section,
        kerf: parseInt(kerf, 10) || 3,
        time_limit: 300,
      };
      const res = await fetch("/cad-review/api/nesting/run/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body?.error ?? `Nesting service returned ${res.status}`); return;
      }
      const started = await res.json();
      const id = started.task_id ?? started.id;
      if (!id) { setErr("The nesting service did not return a task id."); return; }
      setTaskId(id);
      setPhase("Nesting…");
      const done = await poll(id, setPhase);
      if (done) setResult(done);
    } catch { setErr("Could not reach the nesting service"); }
    finally { setBusy(false); setPhase(""); }
  }

  if (err && !input) return <Warn>{err}</Warn>;
  if (!input) return <p className="text-sm text-slate-500">Reading the cut list…</p>;

  const groups = input.by_designation ?? [];
  const totalPieces = groups.reduce((n, g) => n + g.pieces, 0);
  const totalMetres = groups.reduce((n, g) => n + g.total_length_mm, 0) / 1000;

  return (
    <div className="space-y-4">
      {/* An unverified length would nest a member at a size nobody has checked. */}
      {!input.ready && (
        <Warn>
          The cut list is not verified — some member lengths disagree with their profile.
          Nesting now would cut to a length nobody has checked. Settle those in Review first.
        </Warn>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Stock lengths</h2>
          <p className="text-xs text-slate-500">
            {groups.length} section{groups.length === 1 ? "" : "s"} · {totalPieces} pieces ·{" "}
            {totalMetres.toFixed(1)} m. Pre-filled at 12200 mm × 100 bars — edit any row to
            match what is actually in the rack.
          </p>
        </div>
        <label className="text-xs text-slate-600">
          Kerf (mm){" "}
          <input value={kerf} onChange={(e) => setKerf(e.target.value)}
                 className="w-16 rounded border border-slate-300 px-2 py-1 text-sm" />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Section</th>
              <th className="px-3 py-2 text-right font-medium">Pieces</th>
              <th className="px-3 py-2 text-right font-medium">Metres</th>
              <th className="px-3 py-2 text-right font-medium">Longest</th>
              <th className="px-3 py-2 text-right font-medium">Bar length</th>
              <th className="px-3 py-2 text-right font-medium">Bars</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.map((g) => {
              const s = stock[g.designation] ?? { length: DEFAULT_LENGTH, qty: DEFAULT_QTY };
              const tooShort = barFor(g.designation) > 0 &&
                               g.longest_mm > barFor(g.designation);
              return (
                <tr key={g.designation} className={tooShort ? "bg-amber-50" : undefined}>
                  <td className="px-3 py-1.5 font-medium">
                    {g.designation}
                    {g.provisional && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        provisional
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{g.pieces}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {(g.total_length_mm / 1000).toFixed(1)}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${
                        tooShort ? "font-medium text-amber-800" : "text-slate-500"}`}>
                    {Math.round(g.longest_mm)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input value={s.length}
                           onChange={(e) => set(g.designation, "length", e.target.value)}
                           className={`w-24 rounded border px-2 py-1 text-right text-sm tabular-nums ${
                             tooShort ? "border-amber-400" : "border-slate-300"}`} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input value={s.qty}
                           onChange={(e) => set(g.designation, "qty", e.target.value)}
                           className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Named explicitly: an under-length bar is otherwise a silent unplaced item. */}
      {short.length > 0 && (
        <Warn>
          {short.length === 1
            ? `${short[0].designation} has a piece at ${Math.round(short[0].longest_mm)} mm, longer than its bar.`
            : `${short.length} sections have a piece longer than their bar.`}{" "}
          Those pieces cannot be placed — lengthen the bar, or the nest comes back short.
        </Warn>
      )}

      {/* Say what is NOT here, so nobody hunts for it. */}
      {(input.excluded?.length ?? 0) > 0 && (
        <p className="text-xs text-slate-500">
          Not nested here: {input.excluded!.map((e) => e.designation).join(", ")} — plates go to
          sheet nesting separately.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={nest} disabled={busy}
                className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
          {busy ? phase || "Working…" : "Nest"}
        </button>
        {taskId && !busy && (
          <>
            <a href={`/cad-review/api/nesting/cutting-list/${taskId}/csv`}
               className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Cutting list (CSV)
            </a>
            <a href={`/cad-review/api/nesting/cutting-list/${taskId}/pdf`}
               className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              PDF
            </a>
          </>
        )}
        {busy && <span className="text-xs text-slate-500">{phase}</span>}
      </div>

      {err && <Warn>{err}</Warn>}
      {result && <Summary result={result} />}

      <p className="text-xs text-slate-400">
        A nest started here will not appear on the nesting app&apos;s history page — that row is
        written by the nesting app&apos;s own browser session (bd 3pg).
      </p>
    </div>
  );
}

function Summary({ result }: { result: Result }) {
  const t = result.totals;
  const sections = result.sections ?? [];
  if (!t && sections.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <h3 className="mb-2 text-sm font-medium">Result</h3>
      {t && (
        <p className="mb-2 text-xs tabular-nums text-slate-600">
          {t.total_stocks_used} bars · {t.total_items_placed} pieces placed
          {t.total_items_unassigned > 0 ? (
            // Never quiet about this: an unplaced piece is a member that does not get cut.
            <span className="ml-1 font-medium text-amber-800">
              · {t.total_items_unassigned} UNPLACED
            </span>
          ) : (
            <span className="ml-1 text-emerald-700">· all placed</span>
          )}
          {t.total_waste_mm != null &&
            ` · ${(t.total_waste_mm / 1000).toFixed(1)} m waste`}
        </p>
      )}
      <table className="w-full text-xs">
        <tbody className="divide-y divide-slate-100">
          {sections.map((sec) => (
            <tr key={sec.designation}
                className={sec.items_unassigned ? "bg-amber-50" : undefined}>
              <td className="py-1 pr-3 font-medium">{sec.designation}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-slate-600">
                {sec.summary?.stocks_used ?? 0} bar
                {(sec.summary?.stocks_used ?? 0) === 1 ? "" : "s"}
              </td>
              <td className="py-1 pr-3 text-right tabular-nums text-slate-500">
                {sec.items_placed} placed
              </td>
              <td className="py-1 text-right tabular-nums">
                {sec.items_unassigned
                  ? <span className="font-medium text-amber-800">
                      {sec.items_unassigned} unplaced
                    </span>
                  : <span className="text-slate-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </p>
  );
}

async function poll(taskId: string, phase: (s: string) => void,
                    tries = 120): Promise<Result | null> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`/cad-review/api/nesting/status/${taskId}`, { cache: "no-store" });
      if (!res.ok) continue;
      const j = await res.json();
      if (j.status === "completed" || j.status === "done") {
        const cl = await fetch(`/cad-review/api/nesting/cutting-list/${taskId}`,
                               { cache: "no-store" });
        return cl.ok ? await cl.json() : j;
      }
      if (j.status === "failed" || j.status === "error") {
        phase(j.error ? `Failed: ${j.error}` : "Failed."); return null;
      }
    } catch { return null; }
  }
  phase("Still running.");
  return null;
}
