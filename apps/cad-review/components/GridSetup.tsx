"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Set the grid by pointing at the columns that form it (bd s8r8.3).
 *
 * Steve, 2026-09-26: "you provide a section cut from ground in 3d model, i select all the columns
 * foring the grid and then select the principle column that forma a1, we then autofill the columns
 * sequentially from there."
 *
 * So the drawing shows ONE thing - a horizontal cut through the model, seen from above - and the
 * person does two things on it: pick the columns, then point at A1. Everything else follows.
 * Nothing is derived behind their back: a column nobody picked never invents a grid line.
 *
 * The cut is taken midway between the first two levels, which is the one height in a storey where
 * there is nothing but columns. It can be moved, and the drawing always says how many of the
 * model's columns this particular cut catches, so a thin cut is visible rather than silent.
 */

type Part = { id: string; x1: number; y1: number; x2: number; y2: number;
              z0: number; z1: number; designation: string | null; column: boolean };
/** Every column in the scope, whether or not this cut passes through it. */
type Column = Omit<Part, "column"> & { cut: boolean };
type Line = { position: number; label: string; primary: boolean; columns: number };
type Fit = { columns_total: number; adopted: number; unplaced: number };
type Section = {
  z: number; auto_z: number; columns_in_model: number; columns_cut: number;
  columns: Column[]; parts: Part[]; grids: { x: Line[]; y: Line[] }; saved: boolean;
  levels: { elevation: number; name: string }[];
  extent: { x: [number, number]; y: [number, number]; z: [number, number] };
};

const W = 760;
const PAD = 40;

export function GridSetup({ modelId, prefix }: { modelId: string; prefix: string }) {
  const [sec, setSec] = useState<Section | null>(null);
  const [z, setZ] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [origin, setOrigin] = useState<string | null>(null);
  const [letters, setLetters] = useState<"x" | "y">("y");
  const [named, setNamed] = useState<{ x: Line[]; y: Line[] } | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number;
                                     drop: boolean } | null>(null);
  /** What a click does. Plain clicking always picks and unpicks - Steve, 2026-09-26: "if i click
   *  'pick all ##' i would like to be able to deselct... although this currently then sets the A1
   *  position." Pointing at A1 is a deliberate act: the button, or ctrl-click. */
  const [mode, setMode] = useState<"pick" | "a1">("pick");
  const svg = useRef<SVGSVGElement | null>(null);

  const api = `/cad-review/api/cad/models/${modelId}`;
  const qs = `prefix=${encodeURIComponent(prefix)}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const at = z === null ? "" : `&z=${z}`;
        const res = await fetch(`${api}/layout/section/?${qs}${at}`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) { setErr(`section returned ${res.status}`); return; }
        const body: Section = await res.json();
        setErr(null); setSec(body);
        if (z === null) setZ(body.z);
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, qs, z]);

  // ONE set to pick from: every column in the scope. The ones this cut passes through are drawn
  // solid, the rest in amber - Steve, 2026-09-27: "one source and step for picking rather than
  // mulitple steps and confusing overlays at random times."
  const columns = useMemo(() => sec?.columns ?? [], [sec]);
  const cutHere = useMemo(() => columns.filter((c) => c.cut), [columns]);
  const others = useMemo(() => sec?.parts ?? [], [sec]);

  const geom = useMemo(() => {
    const ex = sec?.extent ?? { x: [0, 1] as [number, number], y: [0, 1] as [number, number],
                                z: [0, 1] as [number, number] };
    const w = Math.max(1, ex.x[1] - ex.x[0]);
    const h = Math.max(1, ex.y[1] - ex.y[0]);
    const s = (W - 2 * PAD) / w;
    const H = h * s + 2 * PAD;
    return {
      H, s,
      X: (x: number) => PAD + (x - ex.x[0]) * s,
      Y: (y: number) => H - PAD - (y - ex.y[0]) * s,     // Y up the page, as a plan is drawn
    };
  }, [sec]);

  const toggle = useCallback((id: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) { next.delete(id); if (origin === id) setOrigin(null); }
      else next.add(id);
      return next;
    });
    setNamed(null);
  }, [origin]);

  function local(e: React.MouseEvent) {
    const r = svg.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }

  function bandDone() {
    if (!band) return;
    const [lo, hi] = [Math.min(band.x0, band.x1), Math.max(band.x0, band.x1)];
    const [lo2, hi2] = [Math.min(band.y0, band.y1), Math.max(band.y0, band.y1)];
    if (hi - lo > 4 || hi2 - lo2 > 4) {
      const inside = columns.filter((c) => {
        const cx = geom.X((c.x1 + c.x2) / 2), cy = geom.Y((c.y1 + c.y2) / 2);
        return cx >= lo && cx <= hi && cy >= lo2 && cy <= hi2;
      }).map((c) => c.id);
      setPicked((cur) => {
        const next = new Set(cur);
        // ctrl-drag takes a row back OUT, which is the other half of dragging one in.
        for (const id of inside) {
          if (band.drop) next.delete(id); else next.add(id);
        }
        return next;
      });
      if (band.drop && origin && inside.includes(origin)) setOrigin(null);
      setNamed(null);
    }
    setBand(null);
  }

  function clicked(id: string, e: React.MouseEvent) {
    if (mode === "a1" || e.ctrlKey || e.metaKey) {
      setPicked((cur) => new Set([...cur, id]));      // pointing at it picks it too
      setOrigin(id);
      setMode("pick");
      setNamed(null);
      return;
    }
    toggle(id);
  }

  async function makeGrid() {
    if (!origin) { setErr("point at the column that is A1 first"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/layout/grid/?${qs}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: [...picked], origin, letters }),
      });
      const body = await res.json();
      if (!res.ok) { setErr(body?.detail ?? `grid returned ${res.status}`); return; }
      setNamed(body.grids);
      setFit(body as Fit);
      setSec((cur) => cur && { ...cur, grids: body.grids, saved: true });
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  async function rename(axis: "x" | "y", n: number, label: string) {
    if (!named) return;
    const next = { ...named, [axis]: named[axis].map((l, i) => i === n ? { ...l, label } : l) };
    setNamed(next);
  }

  async function changeLines(change: {
    add?: { axis: "x" | "y"; position: number; columns: number }[];
    remove?: { axis: "x" | "y"; position: number }[];
  }) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/layout/grid/lines/?${qs}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const body = await res.json();
      if (!res.ok) { setErr(body?.detail ?? `adding a line returned ${res.status}`); return; }
      setNamed(body.grids); setFit(body as Fit);
      setSec((cur) => cur && { ...cur, grids: body.grids });
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  async function keepNames() {
    if (!named || !sec) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/layout/?${qs}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels: sec.levels, grids: named,
                               naming: { letters, flip_x: false, flip_y: false } }),
      });
      if (!res.ok) { setErr(`keeping the names returned ${res.status}`); return; }
      setErr(null);
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  if (err && !sec) return <p className="text-sm text-amber-800">{err}</p>;
  if (!sec) return <p className="text-sm text-slate-500">Cutting through the model…</p>;

  const step = named ? 3 : origin || mode === "a1" ? 2 : 1;

  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap gap-4 text-sm">
        {[["Pick the columns that form the grid", picked.size ? `${picked.size} picked` : ""],
          ["Point at the column that is A1", origin ? "set" : ""],
          ["Check the names", named ? "named" : ""]].map(([label, note], n) => (
          <li key={n} className={`flex items-center gap-2 ${step > n ? "text-slate-900"
            : "text-slate-400"}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
              step > n ? "bg-slate-900 text-white" : "bg-slate-200"}`}>{n + 1}</span>
            {label}{note && <span className="text-xs text-emerald-700">({note})</span>}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
        <span>Cut at</span>
        <input type="range" min={sec.extent.z[0]} max={sec.extent.z[1]} step={100}
               value={z ?? sec.z} onChange={(e) => { setZ(Number(e.target.value)); }}
               className="w-56" />
        <span className="tabular-nums font-medium">{Math.round(sec.z).toLocaleString()} mm</span>
        {Math.round(sec.z) !== Math.round(sec.auto_z) && (
          <button onClick={() => setZ(sec.auto_z)} className="text-xs text-sky-700 hover:underline">
            back to {Math.round(sec.auto_z).toLocaleString()}</button>
        )}
        <span className="text-slate-500">
          cuts <b>{sec.columns_cut}</b> of <b>{sec.columns_in_model}</b> columns; the rest stand
          elsewhere in the height and are drawn in amber
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setPicked(new Set(cutHere.map((c) => c.id))); setNamed(null); }}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
            Pick the {cutHere.length} cut here</button>
          <button onClick={() => { setPicked(new Set(columns.map((c) => c.id))); setNamed(null); }}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
            Pick all {columns.length}</button>
          <button onClick={() => setMode(mode === "a1" ? "pick" : "a1")}
                  disabled={picked.size < 2}
                  className={`rounded border px-2 py-1 text-xs disabled:opacity-40 ${
                    mode === "a1" ? "border-red-700 bg-red-700 text-white"
                                  : "border-slate-300 bg-white"}`}>
            {mode === "a1" ? "click the corner column…" : origin ? "Move A1" : "Point at A1"}
          </button>
          <button onClick={() => { setPicked(new Set()); setOrigin(null); setNamed(null); }}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
            Clear</button>
        </div>
      </div>

      <svg ref={svg} width={W} height={geom.H}
           className="touch-none select-none rounded border border-slate-200 bg-white"
           onMouseDown={(e) => { const p = local(e);
             setBand({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, drop: e.ctrlKey || e.metaKey }); }}
           onMouseMove={(e) => { if (band) { const p = local(e); setBand({ ...band, x1: p.x, y1: p.y }); } }}
           onMouseUp={bandDone} onMouseLeave={() => setBand(null)}>
        {/* everything else the cut passes through, faint: context, never clickable */}
        {others.map((p) => (
          <rect key={p.id} x={geom.X(p.x1)} y={geom.Y(p.y2)}
                width={Math.max(1, (p.x2 - p.x1) * geom.s)}
                height={Math.max(1, (p.y2 - p.y1) * geom.s)}
                fill="#e2e8f0" />
        ))}
        {named && (["x", "y"] as const).map((axis) => named[axis].map((l) => (
          <g key={`${axis}${l.position}`}>
            {axis === "x"
              ? <line x1={geom.X(l.position)} x2={geom.X(l.position)} y1={PAD - 16}
                      y2={geom.H - PAD + 16} stroke="#94a3b8"
                      strokeDasharray={l.primary ? undefined : "5 4"} />
              : <line y1={geom.Y(l.position)} y2={geom.Y(l.position)} x1={PAD - 16}
                      x2={W - PAD + 16} stroke="#94a3b8"
                      strokeDasharray={l.primary ? undefined : "5 4"} />}
            <circle cx={axis === "x" ? geom.X(l.position) : PAD - 24}
                    cy={axis === "x" ? geom.H - PAD + 24 : geom.Y(l.position)}
                    r={10} fill="white" stroke="#475569" />
            <text x={axis === "x" ? geom.X(l.position) : PAD - 24}
                  y={(axis === "x" ? geom.H - PAD + 24 : geom.Y(l.position)) + 3.5}
                  textAnchor="middle" fontSize={9} fill="#0f172a">{l.label}</text>
          </g>
        )))}
        {columns.map((c) => {
          const on = picked.has(c.id);
          const isOrigin = origin === c.id;
          const w = Math.max(6, (c.x2 - c.x1) * geom.s);
          const h = Math.max(6, (c.y2 - c.y1) * geom.s);
          return (
            <g key={c.id} onMouseDown={(e) => e.stopPropagation()}
               onClick={(e) => clicked(c.id, e)}
               className="cursor-pointer">
              <rect x={geom.X((c.x1 + c.x2) / 2) - w / 2} y={geom.Y((c.y1 + c.y2) / 2) - h / 2}
                    width={w} height={h} rx={1}
                    fill={isOrigin ? "#b91c1c" : on ? "#0f172a" : c.cut ? "#cbd5e1" : "none"}
                    stroke={isOrigin ? "#7f1d1d" : c.cut ? "none" : "#d97706"}
                    strokeWidth={2} />
              <title>{[c.designation,
                       c.cut ? `cut here` : `stands ${Math.round(c.z0).toLocaleString()} to ` +
                               `${Math.round(c.z1).toLocaleString()}`,
                       on ? "picked" : "not picked",
                       isOrigin ? "A1" : ""].filter(Boolean).join(" · ")}</title>
              {isOrigin && (
                <text x={geom.X((c.x1 + c.x2) / 2) + w} y={geom.Y((c.y1 + c.y2) / 2) - h}
                      fontSize={11} fill="#b91c1c" fontWeight={600}>A1</text>
              )}
            </g>
          );
        })}
        {band && (
          <rect x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)}
                width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)}
                fill="#0ea5e922" stroke="#0ea5e9" strokeDasharray="4 3" />
        )}
      </svg>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-500">
          {mode === "a1"
            ? "Click the column that is A1."
            : "Click a column to pick it or drop it; drag a box over a row to take several. " +
              "Ctrl-drag takes them back out, and ctrl-click sets A1. Amber columns stand " +
              "elsewhere in the height and pick exactly the same way."}
        </span>
        <label className="ml-auto flex items-center gap-1">
          letters run
          <select value={letters} onChange={(e) => setLetters(e.target.value as "x" | "y")}
                  className="rounded border border-slate-300 px-1 py-0.5">
            <option value="y">across the page</option>
            <option value="x">up the page</option>
          </select>
        </label>
        <button onClick={makeGrid} disabled={busy || picked.size < 2 || !origin}
                className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40">
          {named ? "Make the grid again" : "Make the grid"}</button>
        {err && <span className="text-amber-800">{err}</span>}
      </div>

      {fit && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <div>
            <b>{fit.adopted}</b> of the model&apos;s {fit.columns_total} columns stand on this
            grid — including every one at another level that lines up, without being picked.
          </div>
          {fit.unplaced > 0 ? (
            <div className="mt-1 text-slate-700">
              <b>{fit.unplaced}</b> stand on nothing. They are the amber ones with no mark: pick
              any you want a line for and make the grid again.
            </div>
          ) : (
            <div className="mt-1 text-emerald-800">Every column in the model is on the grid.</div>
          )}
        </div>
      )}

      {named && (
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 text-sm">
            <b>{named.y.length} × {named.x.length}</b> lines from {picked.size} columns, counting
            from A1. Rename any of them — a pair of close lines is often C1 and C2 rather than
            C and D.
          </div>
          <div className="flex gap-8">
            {(["y", "x"] as const).map((axis) => (
              <div key={axis}>
                <div className="mb-1 text-xs uppercase text-slate-500">
                  {axis === "y" ? "Across (letters by default)" : "Up the page (numbers)"}
                </div>
                {named[axis].map((l, n) => (
                  <div key={l.position} className="mb-1 flex items-center gap-2 text-sm">
                    <input value={l.label} onChange={(e) => rename(axis, n, e.target.value)}
                           className="w-16 rounded border border-slate-200 px-1 py-0.5" />
                    <span className="tabular-nums text-slate-500">
                      {Math.round(l.position).toLocaleString()}</span>
                    <span className="text-xs text-slate-400">
                      {l.columns} col{l.columns === 1 ? "" : "s"}</span>
                    <button onClick={() => void changeLines({
                              remove: [{ axis, position: l.position }] })}
                            disabled={busy} title="take this line off the grid"
                            className="ml-auto px-1 text-slate-400 hover:text-red-700">×</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button onClick={keepNames} disabled={busy}
                  className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Keep these names</button>
        </div>
      )}
    </div>
  );
}
