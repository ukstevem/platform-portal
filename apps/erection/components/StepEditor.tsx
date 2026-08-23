"use client";

import { useEffect, useState } from "react";
import { DEFAULT_DEPTH, type Step, type Unit } from "./types";

/**
 * Everything a step carries beyond "which pieces": the method text, who and what does it,
 * how long, and whether work stops for a sign-off — plus the controls for deciding what
 * actually travels as one lift.
 *
 * Saves on blur rather than on every keystroke — a planner writing a paragraph of method
 * should not generate a request per character, and should not have to find a Save button
 * either.
 */
export function StepEditor({ step, units, operations, onSave, onDelete, canExtend, onZoom,
                             onDepth, depthBusy, onSplitOut, selected, setSelected,
                             pick3d, setPick3d }: {
  step: Step;
  units: Unit[];
  operations: readonly string[];
  onSave: (fields: Partial<Step>) => Promise<void> | void;
  onDelete: () => void;
  /** True in record mode, where shift-click folds a piece into this step. */
  canExtend?: boolean;
  /** Frame the 3D view on this step's pieces. */
  onZoom?: () => void;
  /** Move one piece a level finer or coarser. */
  onDepth?: (unitPath: string, direction: "inside" | "wider") => void;
  /** Piece currently mid-change, so its controls can be disabled. */
  depthBusy?: string | null;
  /** Move the named pieces out of this step into their own lift. */
  onSplitOut?: (unitPaths: string[]) => void;
  /** Pieces ticked for moving out. Held by the planner so the 3D view can drive it too. */
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  /** When on, clicking a piece in the 3D view ticks it instead of selecting its step. */
  pick3d: boolean;
  setPick3d: (on: boolean) => void;
}) {
  const [draft, setDraft] = useState<Step>(step);
  useEffect(() => setDraft(step), [step]);

  const set = <K extends keyof Step>(k: K, v: Step[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const commit = (k: keyof Step) => {
    if (draft[k] !== step[k]) onSave({ [k]: draft[k] } as Partial<Step>);
  };

  const mass = units.reduce((a, u) => a + u.mass_kg, 0);
  const incomplete = units.some((u) => !u.mass_complete);
  const heaviest = units.reduce((a, u) => Math.max(a, u.mass_kg), 0);

  const field = "w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none";
  const label = "block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    // max-h + shrink-0: the editor is capped and scrolls its own body, so a hundred-piece
    // lift cannot grow the panel and shove the sequence list off the screen.
    <div className="flex max-h-[26rem] min-h-0 shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Step {step.seq}
        </span>
        <div className="flex items-center gap-3">
          {onZoom && (
            <button onClick={onZoom} className="text-xs text-slate-500 hover:text-slate-900">
              Zoom to piece
            </button>
          )}
          <button onClick={onDelete} className="text-xs text-slate-400 hover:text-red-600">
            Delete step
          </button>
        </div>
      </div>

      {/* The editor scrolls inside its own bounds. Left unbounded it grew with the piece
          list and pushed the sequence itself off the screen — you could no longer see the
          plan you were editing. */}
      {/* Pieces lead. When a lift is being broken into sub-assemblies the piece list IS
          the work, and sitting it under six metadata fields put it below the fold. */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-3">
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="flex items-baseline justify-between">
            <span className={label}>
              Pieces in this lift{units.length > 1 ? ` (${units.length})` : ""}
            </span>
            <span className="text-xs tabular-nums text-slate-600">
              {Math.round(mass).toLocaleString("en-GB")} kg
              {incomplete && <span className="ml-1 text-amber-700">(part unknown)</span>}
            </span>
          </div>

          {/* Authoring a sub-assembly lift. A big assembly opened to its parts is still ONE
              lift until somebody says which parts travel together, and that grouping is
              usually nowhere in the CAD — a 319-part stair tower has 102 flat children and
              no five-or-six-way structure to discover. So it gets drawn here instead. */}
          {onSplitOut && units.length > 1 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded bg-white px-2 py-1.5">
              <span className="text-[11px] text-slate-500">
                {selected.size > 0
                  ? `${selected.size} of ${units.length} selected`
                  : pick3d
                    ? "Click pieces in the 3D view"
                    : "Tick the pieces that go up as one lift"}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {/* Reading 102 names to find "stair flight 1" is not how anyone picks a
                    lift. Clicking the steel is. */}
                <button
                  onClick={() => setPick3d(!pick3d)}
                  title="Click pieces in the 3D view to tick them"
                  className={`rounded border px-1.5 py-0.5 text-[11px] ${
                    pick3d
                      ? "border-orange-500 bg-orange-500 text-white"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                >Pick in 3D</button>
                <button
                  onClick={() => setSelected(new Set(units.map((u) => u.unit_path)))}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                >All</button>
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                >None</button>
                <button
                  onClick={() => { onSplitOut([...selected]); setSelected(new Set()); setPick3d(false); }}
                  disabled={selected.size === 0}
                  title="Move the ticked pieces into their own step, just before this one"
                  className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-slate-700 disabled:opacity-30"
                >Move to a new lift</button>
              </span>
            </div>
          )}

          {/* Own scroll: a piece opened to a hundred parts must not set the panel height. */}
          <ul className="mt-1 max-h-56 space-y-0.5 overflow-auto pr-1">
            {units.map((u) => {
              // Nothing may go wider than the default depth: one level above it is the
              // model root, so the whole job would become a single lift.
              const canWider = u.unit_path.split("/").length > DEFAULT_DEPTH;
              const busy = depthBusy === u.unit_path;
              const ticked = selected.has(u.unit_path);
              return (
                <li key={u.unit_path} className="flex items-center gap-1.5 text-xs">
                  {onSplitOut && units.length > 1 && (
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(u.unit_path);
                        else next.delete(u.unit_path);
                        setSelected(next);
                      }}
                      className="shrink-0"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={u.unit_path}>
                    {u.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {u.part_count}p · {Math.round(u.mass_kg).toLocaleString("en-GB")} kg
                  </span>
                  {onDepth && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() => onDepth(u.unit_path, "inside")}
                        disabled={!u.splittable || !!depthBusy}
                        title={u.splittable
                          ? "Open this piece into what it is built from"
                          : "Nothing deeper to open"}
                        className="rounded border border-slate-300 px-1 py-0.5 text-[10px] leading-none text-slate-600 hover:bg-white disabled:opacity-25"
                      >Open</button>
                      <button
                        onClick={() => onDepth(u.unit_path, "wider")}
                        disabled={!canWider || !!depthBusy}
                        title={canWider
                          ? "Put this back together with its siblings"
                          : "Already the widest erection level"}
                        className="rounded border border-slate-300 px-1 py-0.5 text-[10px] leading-none text-slate-600 hover:bg-white disabled:opacity-25"
                      >Close</button>
                    </span>
                  )}
                  {busy && <span className="shrink-0 text-slate-400">…</span>}
                </li>
              );
            })}
            {units.length === 0 && (
              <li className="text-xs text-amber-700">
                No pieces resolve for this step — they may have been removed from the model.
              </li>
            )}
          </ul>

          {units.length > 1 && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Heaviest single piece {Math.round(heaviest).toLocaleString("en-GB")} kg — the
              figure that matters if these go up one at a time.
            </p>
          )}
          {onDepth && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              <b>Open</b> breaks a piece into what it is built from, <b>Close</b> puts it
              back. Opening does not split the lift — tick the pieces that travel together
              and move them out to do that.
            </p>
          )}
          {canExtend && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Shift-click a piece in the 3D view to add it to this step.
            </p>
          )}
        </div>
        <div>
          <label className={label}>Description</label>
          <input
            className={field}
            value={draft.title ?? ""}
            onChange={(e) => set("title", e.target.value)}
            onBlur={() => commit("title")}
            placeholder="What happens in this step"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Operation</label>
            <select
              className={field}
              value={draft.operation ?? "erect"}
              onChange={(e) => { set("operation", e.target.value); onSave({ operation: e.target.value }); }}
            >
              {operations.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Zone / grid</label>
            <input
              className={field}
              value={draft.zone ?? ""}
              onChange={(e) => set("zone", e.target.value)}
              onBlur={() => commit("zone")}
              placeholder="e.g. Grid A, +7.2m"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={label}>Plant</label>
            <input className={field} value={draft.plant ?? ""}
              onChange={(e) => set("plant", e.target.value)} onBlur={() => commit("plant")}
              placeholder="crane" />
          </div>
          <div>
            <label className={label}>Crew</label>
            <input className={field} value={draft.crew ?? ""}
              onChange={(e) => set("crew", e.target.value)} onBlur={() => commit("crew")}
              placeholder="2 + slinger" />
          </div>
          <div>
            <label className={label}>Hours</label>
            <input className={field} type="number" step="0.25" min="0"
              value={draft.duration_hours ?? ""}
              onChange={(e) => set("duration_hours",
                e.target.value === "" ? null : Number(e.target.value))}
              onBlur={() => commit("duration_hours")} />
          </div>
        </div>

        <div>
          <label className={label}>Method / notes</label>
          <textarea
            className={`${field} min-h-[4rem] resize-y`}
            value={draft.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            onBlur={() => commit("notes")}
            placeholder="Rigging, access, temporary restraint, anything the gang needs to know"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={!!draft.hold_point}
            onChange={(e) => { set("hold_point", e.target.checked); onSave({ hold_point: e.target.checked }); }}
          />
          Hold point — work stops here until signed off
        </label>

      </div>
    </div>
  );
}
