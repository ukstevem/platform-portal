"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The levels, one at a time, yes or no (bd s8r8.2).
 *
 * Steve, 2026-09-26: "provide the ui with a 3d iso view of the levels detected, one by one, they
 * user then yes/no on each", and "show the full scoped solids, but all are ghosted except for that
 * in question."
 *
 * So each level is drawn solid inside a ghost of the whole structure, and every picture uses the
 * SAME camera - which is what makes them comparable. A platform of six beams and a whole floor
 * look identical when each is fitted to its own contents; against the building they are obviously
 * different things, and the answer takes a second rather than a study.
 *
 * Nothing is saved until the last one is answered: it is a pass over the model, not fifteen
 * separate decisions that half-apply.
 */

type Level = { elevation: number; name: string; steel_m: number | null; members: number;
               source: string };
type Layout = { levels: Level[]; grids: { x: unknown[]; y: unknown[] }; saved: boolean;
                naming: { letters: "x" | "y"; flip_x: boolean; flip_y: boolean };
                /** The renderer's version, for the picture URLs (bd ns4z). */
                render?: string };

export function LevelReview({ modelId, prefix }: { modelId: string; prefix: string }) {
  const [lay, setLay] = useState<Layout | null>(null);
  const [at, setAt] = useState(0);
  const [yes, setYes] = useState<Record<number, boolean>>({});
  const [pic, setPic] = useState<string | null>(null);
  const [state, setState] = useState<"drawing" | "ready" | "none" | "unprepared">("drawing");
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cache = useRef<Map<number, string>>(new Map());

  const api = `/cad-review/api/cad/models/${modelId}`;
  /** What the service said, not just the number - a status code alone is not actionable. */
  const why = useCallback(async (res: Response, what: string) => {
    let detail = "";
    try {
      const body = await res.json();
      detail = [body?.detail, body?.ref ? `(ref ${body.ref})` : ""].filter(Boolean).join(" ");
    } catch { /* not json: the status is all there is */ }
    return `${what} returned ${res.status}${detail ? ` — ${detail}` : ""}`;
  }, []);
  const qs = `prefix=${encodeURIComponent(prefix)}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/layout/?${qs}`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) { setErr(await why(res, "the layout")); return; }
        const body: Layout = await res.json();
        setLay(body); setErr(null);
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, qs]);

  // Memoised: a bare `lay?.levels ?? []` is a new array on every render, and every effect that
  // depends on it then re-runs on every render (bd ns4z - that is an infinite loop in JointPairs).
  const levels = useMemo(() => lay?.levels ?? [], [lay]);
  const level = levels[at];
  const render = lay?.render ?? "";

  const draw = useCallback(async (elevation: number): Promise<string | "none" | "unprepared"> => {
    const had = cache.current.get(elevation);
    if (had) return had;
    const res = await fetch(`${api}/layout/level-thumbnail/?${qs}&elevation=${elevation}`
      + `&r=${encodeURIComponent(render)}`);
    if (res.status === 202) return "unprepared";
    if (res.status === 204 || !res.ok) return "none";
    const url = URL.createObjectURL(await res.blob());
    cache.current.set(elevation, url);
    return url;
  }, [api, qs, render]);

  useEffect(() => {
    let live = true;
    if (!level) return;
    setState("drawing"); setPic(null);
    (async () => {
      const got = await draw(level.elevation);
      if (!live) return;
      if (got === "none") { setState("none"); return; }
      if (got === "unprepared") { setState("unprepared"); return; }
      setPic(got); setState("ready");
      const next = levels[at + 1];                 // draw the next one while this is being read
      if (next) void draw(next.elevation);
    })();
    return () => { live = false; };
  }, [level, levels, at, draw]);

  const answered = Object.keys(yes).length;
  const keeping = useMemo(() => levels.filter((l) => yes[l.elevation] !== false), [levels, yes]);

  function answer(keep: boolean) {
    if (!level) return;
    setYes((cur) => ({ ...cur, [level.elevation]: keep }));
    setKept(false);
    if (at < levels.length - 1) setAt(at + 1);
  }

  async function keepAll() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/layout/?${qs}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          levels: keeping.map((l) => ({ ...l, source: "human" })),
          grids: lay?.grids ?? { x: [], y: [] },
          naming: lay?.naming ?? { letters: "y", flip_x: false, flip_y: false },
        }),
      });
      if (!res.ok) { setErr(await why(res, "keeping the levels")); return; }
      const body: Layout = await res.json();
      setLay(body); setKept(true);
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  if (err && !lay) return <p className="text-sm text-amber-800">{err}</p>;
  if (!lay) return <p className="text-sm text-slate-500">Measuring the steel…</p>;
  if (!levels.length) return <p className="text-sm text-slate-500">No levels found here.</p>;

  const verdict = level ? yes[level.elevation] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Level {at + 1} of {levels.length}</span>
        <div className="h-1.5 w-40 overflow-hidden rounded bg-slate-200">
          <div className="h-full bg-slate-900"
               style={{ width: `${(answered / levels.length) * 100}%` }} />
        </div>
        <span className="text-slate-500">
          {answered} answered · keeping {keeping.length}
        </span>
        {kept && <span className="text-emerald-700">kept</span>}
        {err && <span className="text-amber-800">{err}</span>}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative min-h-[380px] w-[560px] rounded border border-slate-200 bg-white">
          {state === "ready" && pic && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pic} alt={`level ${level?.name}`} width={560} height={380} />
          )}
          {state === "drawing" && (
            <p className="p-4 text-sm text-slate-500">Drawing {level?.name}…</p>
          )}
          {state === "none" && (
            <p className="p-4 text-sm text-slate-500">Nothing to draw at this level.</p>
          )}
          {state === "unprepared" && (
            <p className="p-4 text-sm text-amber-800">
              The model&apos;s surfaces are not prepared yet — prepare the pictures on the Pieces
              tab and come back.
            </p>
          )}
        </div>

        <div className="min-w-[16rem] flex-1 space-y-3">
          <div>
            <div className="text-2xl font-semibold tabular-nums">{level?.name}</div>
            <div className="text-sm text-slate-500">
              {level?.steel_m ? `${level.steel_m.toFixed(0)} m of floor steel` : "added by hand"}
              {level?.members ? ` · ${level.members} members` : ""}
            </div>
          </div>
          <p className="text-sm text-slate-600">
            Is this a <b>level</b> — a floor the building is set out on — or something smaller: a
            platform, a walkway, a machine support?
          </p>
          <div className="flex gap-2">
            <button onClick={() => answer(true)} disabled={state === "drawing"}
                    className={`rounded px-4 py-2 text-sm ${verdict === true
                      ? "bg-emerald-700 text-white" : "bg-slate-900 text-white"}`}>
              Yes — it is a level</button>
            <button onClick={() => answer(false)} disabled={state === "drawing"}
                    className={`rounded border px-4 py-2 text-sm ${verdict === false
                      ? "border-red-700 bg-red-700 text-white"
                      : "border-slate-300 bg-white"}`}>
              No</button>
          </div>
          <p className="text-xs text-slate-500">
            Saying no merges its steel into the nearest level you keep — nothing is lost, it just
            stops being a floor of its own.
          </p>

          <div className="flex gap-2 pt-2">
            <button onClick={() => setAt(Math.max(0, at - 1))} disabled={at === 0}
                    className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">
              ← back</button>
            <button onClick={() => setAt(Math.min(levels.length - 1, at + 1))}
                    disabled={at >= levels.length - 1}
                    className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">
              skip →</button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">All {levels.length}</span>
          <span className="text-slate-500">click one to go to it</span>
          <button onClick={keepAll} disabled={busy || answered === 0}
                  className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            Keep the {keeping.length} I said yes to</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {levels.map((l, n) => {
            const v = yes[l.elevation];
            return (
              <button key={l.elevation} onClick={() => setAt(n)}
                      className={`rounded border px-2 py-1 text-xs tabular-nums ${
                        n === at ? "border-slate-900 font-medium" : "border-slate-200"} ${
                        v === true ? "bg-emerald-50 text-emerald-900"
                        : v === false ? "bg-red-50 text-red-900 line-through" : "bg-white"}`}>
                {l.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
