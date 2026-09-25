"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Levels and grids, set on a drawing (bd s8r8.2, s8r8.3).
 *
 * Steve, 2026-09-25, working a 13,839-part job: "we need to get the grid and levels set first...
 * i cant tell anything from a table. i need something graphical to look at."
 *
 * So: a PLAN with the grid lines, the columns standing on them and the floor steel of whichever
 * level is chosen, and an ELEVATION with the level bands and the columns rising through them. Both
 * are drawn from the real coordinates the connection sweep measured, at 1:1 in mm, scaled to fit.
 *
 * Everything here is DERIVED and then owned by a person: the machine proposes the levels and the
 * lines with the evidence beside them (metres of floor steel, columns on a line), and the person
 * names them, drops the ones that are not levels, and says which corner is A1 - the one thing no
 * geometry can decide.
 */

type Level = { elevation: number; name: string; steel_m: number | null; members: number;
               source: string };
type Line = { position: number; label: string; primary: boolean; columns: number;
              weak: boolean; source: string };
type Grids = { x: Line[]; y: Line[] };
type Column = { id: string; x: number; y: number; z0: number; z1: number; size: number;
                designation: string | null; grid: string | null; level: string | null };
type Floor = { x1: number; y1: number; x2: number; y2: number; z: number; level: string | null };
type Layout = {
  prefix: string; name: string | null; saved: boolean;
  naming: { letters: "x" | "y"; flip_x: boolean; flip_y: boolean };
  levels: Level[]; grids: Grids; derived: { levels: Level[]; grids: Grids };
  columns: Column[]; floors: Floor[];
  extent: { x: [number, number]; y: [number, number]; z: [number, number] };
};

const PAD = 46;                       // room for the grid bubbles outside the steel
const PLAN_W = 620;
const ELEV_W = 480;

export function LayoutDrawings({ modelId, prefix }: { modelId: string; prefix: string }) {
  const [lay, setLay] = useState<Layout | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [grids, setGrids] = useState<Grids>({ x: [], y: [] });
  const [naming, setNaming] = useState<Layout["naming"]>({ letters: "y", flip_x: false,
                                                           flip_y: false });
  const [level, setLevel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addAt, setAddAt] = useState("");

  const api = `/cad-review/api/cad/models/${modelId}`;
  const qs = `prefix=${encodeURIComponent(prefix)}`;

  const take = useCallback((body: Layout) => {
    setLay(body);
    setLevels(body.levels);
    setGrids(body.grids);
    setNaming(body.naming);
    setDirty(false);
    setLevel((cur) => cur && body.levels.some((l) => l.name === cur) ? cur
      : body.levels.length ? body.levels[Math.floor(body.levels.length / 2)].name : null);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/layout/?${qs}`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) { setErr(`layout returned ${res.status}`); return; }
        take(await res.json());
        setErr(null);
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, qs, take]);

  async function send(method: "PUT" | "POST", path: string, body?: unknown) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${api}/layout${path}?${qs}`, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) { setErr(`${method} returned ${res.status}`); return; }
      take(await res.json());
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  const relabel = (n: Layout["naming"]) => { setNaming(n); void send("POST", "/derive/", n); };

  if (err && !lay) return <p className="text-sm text-amber-800">{err}</p>;
  if (!lay) return <p className="text-sm text-slate-500">Measuring the steel…</p>;

  const ex = lay.extent;
  const floors = lay.floors.filter((f) => f.level === level);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
        <span className={lay.saved && !dirty ? "text-emerald-800" : "text-slate-700"}>
          {dirty ? "Changed — not kept yet"
            : lay.saved ? "This arrangement is kept" : "Derived from the steel — not kept yet"}
        </span>
        <span className="text-slate-500">
          {levels.length} levels · {grids.x.filter((l) => l.primary).length}×
          {grids.y.filter((l) => l.primary).length} grid · {lay.columns.length} columns
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => void send("PUT", "/", { levels, grids, naming })}
                  disabled={busy}
                  className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">
            Keep this arrangement</button>
          <button onClick={() => void send("POST", "/derive/", naming)} disabled={busy}
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-sm">
            Derive again</button>
        </div>
        {err && <span className="text-amber-800">{err}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-slate-500">Letters run on</span>
        {(["y", "x"] as const).map((ax) => (
          <label key={ax} className="flex items-center gap-1">
            <input type="radio" checked={naming.letters === ax}
                   onChange={() => relabel({ ...naming, letters: ax })} />
            {ax === "y" ? "the lines across (A at the bottom)" : "the lines up the page (A at the left)"}
          </label>
        ))}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={naming.flip_x}
                 onChange={(e) => relabel({ ...naming, flip_x: e.target.checked })} />
          count X from the other end
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={naming.flip_y}
                 onChange={(e) => relabel({ ...naming, flip_y: e.target.checked })} />
          count Y from the other end
        </label>
      </div>

      <div className="flex flex-wrap gap-6">
        <figure className="space-y-1">
          <figcaption className="text-xs uppercase tracking-wide text-slate-500">
            Plan{level ? ` at ${level}` : ""} — {floors.length} floor members
          </figcaption>
          <Plan grids={grids} columns={lay.columns} floors={floors} ex={ex} level={level} />
        </figure>
        <figure className="space-y-1">
          <figcaption className="text-xs uppercase tracking-wide text-slate-500">
            Elevation — click a level to see its plan
          </figcaption>
          <Elevation levels={levels} columns={lay.columns} ex={ex} level={level}
                     onPick={setLevel} />
        </figure>
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="min-w-[22rem] flex-1">
          <h3 className="mb-1 text-sm font-medium">Levels</h3>
          <p className="mb-2 text-xs text-slate-500">
            Named by elevation. Metres of FLOOR steel is why each one is here — cladding rail and
            handrail are left out, or this job would show 23 levels that nobody walks on. Drop one
            and its steel joins the nearest level that is left.
          </p>
          <table className="w-full text-sm">
            <tbody>
              {levels.map((lv, n) => (
                <tr key={lv.elevation}
                    className={`border-b border-slate-100 ${level === lv.name ? "bg-sky-50" : ""}`}>
                  <td className="py-1 pr-2">
                    <input value={lv.name} onChange={(e) => {
                      const next = [...levels];
                      next[n] = { ...lv, name: e.target.value, source: "human" };
                      setLevels(next); setDirty(true);
                      if (level === lv.name) setLevel(e.target.value);
                    }} className="w-24 rounded border border-slate-200 px-1 py-0.5" />
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-slate-500">
                    {Math.round(lv.elevation).toLocaleString()}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {lv.steel_m ? `${lv.steel_m.toFixed(0)} m` : ""}</td>
                  <td className="py-1 pr-2 text-right tabular-nums text-slate-500">
                    {lv.members || ""}</td>
                  <td className="py-1 pr-2">
                    <button onClick={() => setLevel(lv.name)}
                            className="text-xs text-sky-700 hover:underline">plan</button>
                  </td>
                  <td className="py-1 text-right">
                    <button onClick={() => {
                      setLevels(levels.filter((x) => x.elevation !== lv.elevation));
                      setDirty(true);
                    }} className="px-1 text-slate-400 hover:text-red-700" title="not a level">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input value={addAt} onChange={(e) => setAddAt(e.target.value)}
                   placeholder="elevation, mm"
                   className="w-28 rounded border border-slate-300 px-2 py-1" />
            <button disabled={!addAt.trim() || Number.isNaN(Number(addAt))}
                    onClick={() => {
                      const z = Number(addAt);
                      const name = z >= 0 ? `+${Math.round(z)}` : `${Math.round(z)}`;
                      setLevels([...levels, { elevation: z, name, steel_m: null, members: 0,
                                              source: "human" }]
                        .sort((a, b) => a.elevation - b.elevation));
                      setAddAt(""); setDirty(true);
                    }}
                    className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
              Add a level</button>
            <span className="text-xs text-slate-500">
              splits one level into two — the steel divides by which is nearer
            </span>
          </div>
        </div>

        <div className="min-w-[20rem] flex-1">
          <h3 className="mb-1 text-sm font-medium">Grid lines</h3>
          <p className="mb-2 text-xs text-slate-500">
            Where the columns stand. A line with one column on it is a sub-grid line (2.1) and is
            drawn dashed. Rename any of them; the names are yours.
          </p>
          <div className="flex gap-6">
            {(["x", "y"] as const).map((ax) => (
              <div key={ax} className="flex-1">
                <div className="mb-1 text-xs uppercase text-slate-500">
                  {ax === "x" ? "Across (X)" : "Up the page (Y)"}
                </div>
                {grids[ax].map((ln, n) => (
                  <div key={ln.position} className="mb-1 flex items-center gap-2 text-sm">
                    <input value={ln.label} onChange={(e) => {
                      const next = { ...grids, [ax]: [...grids[ax]] };
                      next[ax][n] = { ...ln, label: e.target.value, source: "human" };
                      setGrids(next); setDirty(true);
                    }} className="w-14 rounded border border-slate-200 px-1 py-0.5" />
                    <span className="tabular-nums text-slate-500">
                      {Math.round(ln.position).toLocaleString()}</span>
                    <span className="text-xs text-slate-400">
                      {ln.columns} col{ln.columns === 1 ? "" : "s"}</span>
                    <button onClick={() => {
                      const next = { ...grids, [ax]: grids[ax].filter((_, i) => i !== n) };
                      setGrids(next); setDirty(true);
                    }} className="ml-auto px-1 text-slate-400 hover:text-red-700">×</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The plan: grid lines and their bubbles, the columns, and one level's floor steel. */
function Plan({ grids, columns, floors, ex, level }: {
  grids: Grids; columns: Column[]; floors: Floor[];
  ex: Layout["extent"]; level: string | null;
}) {
  const w = Math.max(1, ex.x[1] - ex.x[0]);
  const h = Math.max(1, ex.y[1] - ex.y[0]);
  const s = (PLAN_W - 2 * PAD) / w;
  const H = h * s + 2 * PAD;
  const X = (x: number) => PAD + (x - ex.x[0]) * s;
  const Y = (y: number) => H - PAD - (y - ex.y[0]) * s;       // Y up the page, as a plan is drawn
  const atLevel = (c: Column) => !level || (c.level || "").includes(level);

  return (
    <svg width={PLAN_W} height={H} className="rounded border border-slate-200 bg-white">
      {grids.y.map((ln) => (
        <g key={`y${ln.position}`}>
          <line x1={PAD - 18} x2={PLAN_W - PAD + 18} y1={Y(ln.position)} y2={Y(ln.position)}
                stroke={ln.primary ? "#94a3b8" : "#cbd5e1"}
                strokeDasharray={ln.primary ? undefined : "5 4"} strokeWidth={1} />
          <Bubble x={PAD - 26} y={Y(ln.position)} label={ln.label} primary={ln.primary} />
        </g>
      ))}
      {grids.x.map((ln) => (
        <g key={`x${ln.position}`}>
          <line y1={PAD - 18} y2={H - PAD + 18} x1={X(ln.position)} x2={X(ln.position)}
                stroke={ln.primary ? "#94a3b8" : "#cbd5e1"}
                strokeDasharray={ln.primary ? undefined : "5 4"} strokeWidth={1} />
          <Bubble x={X(ln.position)} y={H - PAD + 26} label={ln.label} primary={ln.primary} />
        </g>
      ))}
      {floors.map((f, n) => (
        <line key={n} x1={X(f.x1)} y1={Y(f.y1)} x2={X(f.x2)} y2={Y(f.y2)}
              stroke="#0ea5e9" strokeWidth={2} strokeLinecap="round" opacity={0.75} />
      ))}
      {columns.map((c) => {
        const size = Math.max(4, c.size * s);
        return (
          <rect key={c.id} x={X(c.x) - size / 2} y={Y(c.y) - size / 2} width={size} height={size}
                fill={atLevel(c) ? "#0f172a" : "#cbd5e1"} rx={1}>
            <title>{[c.designation, c.grid, c.level].filter(Boolean).join(" · ")}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function Bubble({ x, y, label, primary }: {
  x: number; y: number; label: string; primary: boolean;
}) {
  if (!label) return null;
  return (
    <g>
      <circle cx={x} cy={y} r={primary ? 11 : 9} fill="white"
              stroke={primary ? "#475569" : "#94a3b8"}
              strokeDasharray={primary ? undefined : "3 3"} />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={primary ? 10 : 8}
            fill="#0f172a">{label}</text>
    </g>
  );
}

/** The elevation: level bands with their names, and the columns rising through them. */
function Elevation({ levels, columns, ex, level, onPick }: {
  levels: Level[]; columns: Column[]; ex: Layout["extent"]; level: string | null;
  onPick: (n: string) => void;
}) {
  const w = Math.max(1, ex.x[1] - ex.x[0]);
  const hz = Math.max(1, ex.z[1] - ex.z[0]);
  const sx = (ELEV_W - 2 * PAD) / w;
  const H = Math.min(760, Math.max(360, hz * sx));
  const sz = (H - 2 * PAD) / hz;
  const X = (x: number) => PAD + (x - ex.x[0]) * sx;
  const Z = (z: number) => H - PAD - (z - ex.z[0]) * sz;
  const most = useMemo(() => Math.max(1, ...levels.map((l) => l.steel_m || 0)), [levels]);

  return (
    <svg width={ELEV_W} height={H} className="rounded border border-slate-200 bg-white">
      {columns.map((c) => (
        <line key={c.id} x1={X(c.x)} x2={X(c.x)} y1={Z(c.z0)} y2={Z(c.z1)}
              stroke="#cbd5e1" strokeWidth={Math.max(1, Math.min(4, c.size * sx))} />
      ))}
      {levels.map((lv) => {
        const on = lv.name === level;
        return (
          <g key={lv.elevation} onClick={() => onPick(lv.name)} className="cursor-pointer">
            <rect x={0} y={Z(lv.elevation) - 7} width={ELEV_W} height={14}
                  fill={on ? "#e0f2fe" : "transparent"} />
            <line x1={PAD - 20} x2={X(ex.x[1])} y1={Z(lv.elevation)} y2={Z(lv.elevation)}
                  stroke={on ? "#0284c7" : "#475569"}
                  strokeWidth={1 + 2.5 * ((lv.steel_m || 0) / most)} />
            <text x={2} y={Z(lv.elevation) - 3} fontSize={10}
                  fill={on ? "#0369a1" : "#334155"}>{lv.name}</text>
            <text x={ELEV_W - 4} y={Z(lv.elevation) - 3} fontSize={9} textAnchor="end"
                  fill="#94a3b8">{lv.steel_m ? `${lv.steel_m.toFixed(0)} m` : "added"}</text>
          </g>
        );
      })}
    </svg>
  );
}
