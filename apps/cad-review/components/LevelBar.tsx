"use client";

/**
 * The job a floor at a time (bd s8r8.5).
 *
 * Steve, 2026-09-23: "Buildings work on levels and grids, stairs work from level to level." A
 * node of 3,895 pieces is not a thing anybody can work through; nine floors of four hundred are.
 *
 * "Between levels" is a level here, and deliberately so: the columns, stair runs and bracing that
 * cross floors belong to no single one of them, and they are erected as their own piece of the job
 * (Steve, 2026-09-27). On job 10335 that is 166 pieces and 97 t, a quarter of the structure - far
 * too much to let fall between two stools.
 *
 * Nothing here regroups anything. A level is a VIEW of the node's pieces, so a piece cannot be cut
 * in half by looking at it from a different angle.
 */

export type LevelRow = {
  level: string; pieces: number; kinds: number; mass_kg: number; mass_complete: boolean;
  signoff?: { signed_at: string; note: string | null } | null;
};

const WHOLE = "";

export function LevelBar({ levels, level, onPick, total }: {
  levels: LevelRow[]; level: string; onPick: (level: string) => void; total?: number;
}) {
  if (!levels?.length) return null;
  const all = levels.reduce((n, r) => n + r.pieces, 0);
  const tonnes = (kg: number) => (kg / 1000).toFixed(kg >= 10000 ? 0 : 1);

  return (
    <div className="flex flex-wrap items-stretch gap-1">
      <button onClick={() => onPick(WHOLE)}
              className={`rounded border px-3 py-1.5 text-left text-xs ${level === WHOLE
                ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}>
        <div className="font-medium">Whole node</div>
        <div className={level === WHOLE ? "text-slate-300" : "text-slate-500"}>
          {(total ?? all).toLocaleString()} pieces
        </div>
      </button>
      {levels.map((r) => {
        const on = level === r.level;
        const done = !!r.signoff;
        return (
          <button key={r.level} onClick={() => onPick(r.level)} title={done
            ? `signed off ${new Date(r.signoff!.signed_at).toLocaleString()}` : undefined}
            className={`rounded border px-3 py-1.5 text-left text-xs ${on
              ? "border-slate-900 bg-slate-900 text-white"
              : done ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-white"}`}>
            <div className="font-medium tabular-nums">
              {done && !on ? "✓ " : ""}{r.level}
            </div>
            <div className={on ? "text-slate-300" : "text-slate-500"}>
              {r.pieces.toLocaleString()} · {tonnes(r.mass_kg)} t
            </div>
          </button>
        );
      })}
    </div>
  );
}
