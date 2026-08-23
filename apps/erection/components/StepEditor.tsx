"use client";

import { useEffect, useState } from "react";
import { DEFAULT_DEPTH, type Step, type Unit } from "./types";

/**
 * Everything a step carries beyond "which pieces": the method text, who and what does it,
 * how long, and whether work stops for a sign-off.
 *
 * Saves on blur rather than on every keystroke — a planner writing a paragraph of method
 * should not generate a request per character, and should not have to find a Save button
 * either.
 */
export function StepEditor({ step, units, operations, onSave, onDelete, canExtend, onZoom,
                             onDepth, depthBusy }: {
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
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
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

      <div className="space-y-2.5 p-3">
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
            className={`${field} min-h-[4.5rem] resize-y`}
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

        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="flex items-baseline justify-between">
            <span className={label}>Pieces in this lift</span>
            <span className="text-xs tabular-nums text-slate-600">
              {Math.round(mass).toLocaleString("en-GB")} kg
              {incomplete && <span className="ml-1 text-amber-700">(part unknown)</span>}
            </span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {units.map((u) => {
              // Nothing may go wider than the default depth: one level above it is the
              // model root, so the whole job would become a single lift.
              const canWider = u.unit_path.split("/").length > DEFAULT_DEPTH;
              const busy = depthBusy === u.unit_path;
              return (
                <li key={u.unit_path} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-700" title={u.unit_path}>{u.name}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="tabular-nums text-slate-500">
                      {u.part_count}p · {Math.round(u.mass_kg).toLocaleString("en-GB")} kg
                    </span>
                    {onDepth && (
                      <>
                        <button
                          onClick={() => onDepth(u.unit_path, "wider")}
                          disabled={!canWider || !!depthBusy}
                          title={canWider
                            ? "Wider — put this back together with its siblings"
                            : "Already the widest erection level"}
                          className="ml-1 rounded border border-slate-300 px-1 leading-4 text-slate-600 hover:bg-white disabled:opacity-30"
                        >−</button>
                        <button
                          onClick={() => onDepth(u.unit_path, "inside")}
                          disabled={!u.splittable || !!depthBusy}
                          title={u.splittable
                            ? "Inside — break this into the pieces it is built from"
                            : "Nothing deeper to open"}
                          className="rounded border border-slate-300 px-1 leading-4 text-slate-600 hover:bg-white disabled:opacity-30"
                        >+</button>
                      </>
                    )}
                    {busy && <span className="text-slate-400">…</span>}
                  </span>
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
              <b>+</b> opens a piece into what it is built from; <b>−</b> puts it back. The
              steps come with it.
            </p>
          )}
          {canExtend && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Shift-click a piece in the 3D view to add it to this step — for pieces that go
              up as one lift.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
