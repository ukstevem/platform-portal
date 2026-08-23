"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SequenceViewer, type UnitState, type ViewerHandle } from "./SequenceViewer";
import { StepEditor } from "./StepEditor";
import { OPERATIONS, type Step, type Unit, type Plan } from "./types";

/**
 * The planner: pick pieces in the order they go up, then read the sequence back.
 *
 * Two modes, because they are genuinely different jobs. In RECORD you are authoring — each
 * click in the 3D view appends the next step, and the view shows the structure as it will
 * stand at that moment, so you are choosing the next lift against what is actually up.
 * In REVIEW you are reading — clicking selects, and the scrubber walks the sequence.
 */

const api = (modelId: string, path: string) =>
  `/erection/api/cad/models/${modelId}/erection/${path}`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

const kg = (v: number) => `${Math.round(v).toLocaleString("en-GB")} kg`;

export function ErectionPlanner({ modelId, projectRef, modelName }: {
  modelId: string; projectRef?: string | null; modelName?: string | null;
}) {
  const viewer = useRef<ViewerHandle>(null);

  const [units, setUnits] = useState<Unit[]>([]);
  const [instanceUnits, setInstanceUnits] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [mode, setMode] = useState<"record" | "review">("record");
  const [cursor, setCursor] = useState(0);        // index into steps, for review playback
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // Pieces ticked for moving out of the selected step, and whether the 3D view is currently
  // driving that selection. Held here rather than in the editor because the viewer feeds it,
  // and declared before `pick` so the click handler can read it.
  const [selectedPieces, setSelectedPieces] = useState<Set<string>>(new Set());
  const [pick3d, setPick3d] = useState(false);

  const steps: Step[] = useMemo(() => plan?.steps ?? [], [plan]);
  const stepListRef = useRef<HTMLUListElement>(null);
  const unitByPath = useMemo(
    () => Object.fromEntries(units.map((u) => [u.unit_path, u])), [units]);

  // ── load ───────────────────────────────────────────────────────────────────

  const loadUnits = useCallback(async () => {
    const d = await call<{ units: Unit[]; instance_units: Record<string, string> }>(
      api(modelId, "units/"));
    setUnits(d.units);
    setInstanceUnits(d.instance_units);
  }, [modelId]);

  const loadPlan = useCallback(async () => {
    setPlan(await call<Plan>(api(modelId, "plan/")));
  }, [modelId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadUnits(), loadPlan()]);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the plan");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadUnits, loadPlan]);

  // ── derived view state ─────────────────────────────────────────────────────

  /** Which step's moment the 3D view is showing. */
  const shownIndex = mode === "record" ? steps.length : cursor;

  const stateByUnit = useMemo(() => {
    const out: Record<string, UnitState> = {};
    for (const u of units) out[u.unit_path] = "unsequenced";
    steps.forEach((s, i) => {
      const st: UnitState = i < shownIndex ? "erected" : i === shownIndex ? "current" : "future";
      for (const it of s.items) out[it.unit_path] = st;
    });
    // Ticked pieces last, so a selection is visible whichever step it belongs to. Without
    // this every piece of a 102-piece lift is the same orange and you cannot see what you
    // have chosen — which is most of the point of picking in the view at all.
    //
    // While a selection is being made, the REST of that step drops back too. Three picked
    // pieces in a hundred-piece lift are a handful of pixels against a wall of orange;
    // muting their neighbours is what makes them findable without zooming in.
    if (selectedPieces.size > 0) {
      const step = steps.find((s) => s.id === selectedStep);
      for (const it of step?.items ?? []) {
        if (out[it.unit_path] === "current") out[it.unit_path] = "current-muted";
      }
      for (const path of selectedPieces) {
        if (out[path]) out[path] = "picked";
      }
    }
    return out;
  }, [units, steps, shownIndex, selectedPieces, selectedStep]);

  const totals = useMemo(() => {
    const sequenced = new Set(steps.flatMap((s) => s.items.map((i) => i.unit_path)));
    let erected = 0, incomplete = false;
    steps.slice(0, Math.max(shownIndex, 0) + (mode === "record" ? 0 : 1)).forEach((s) => {
      s.items.forEach((it) => {
        const u = unitByPath[it.unit_path];
        if (!u) return;
        erected += u.mass_kg;
        if (!u.mass_complete) incomplete = true;
      });
    });
    const all = units.reduce((a, u) => a + u.mass_kg, 0);
    return {
      erected, all, incomplete,
      unsequenced: units.filter((u) => !sequenced.has(u.unit_path)).length,
    };
  }, [steps, units, unitByPath, shownIndex, mode]);

  // ── actions ────────────────────────────────────────────────────────────────

  const pick = useCallback(async (unitPath: string, opts?: { shift: boolean }) => {
    const u = unitByPath[unitPath];
    if (!u) return;

    // Picking a lift out of an opened assembly: a click ticks the piece rather than doing
    // anything to the plan. Only pieces of the step being edited can be ticked — clicking
    // elsewhere in the structure would otherwise silently build a selection you cannot see.
    if (pick3d && selectedStep) {
      const step = steps.find((s) => s.id === selectedStep);
      if (step?.items.some((i) => i.unit_path === unitPath)) {
        setSelectedPieces((prev) => {
          const next = new Set(prev);
          if (next.has(unitPath)) next.delete(unitPath);
          else next.add(unitPath);
          return next;
        });
      }
      return;
    }

    // Shift = "same lift as the selected step" rather than "the next step".
    if (mode === "record" && opts?.shift && selectedStep) {
      const step = steps.find((s) => s.id === selectedStep);
      if (step && !step.items.some((i) => i.unit_path === unitPath)) {
        setBusy("updating");
        try {
          setPlan(await call<Plan>(api(modelId, `steps/${step.id}/items/`), {
            method: "PUT",
            body: JSON.stringify({ items: [...step.items, { unit_path: unitPath }] }),
          }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not update the step");
        } finally { setBusy(null); }
      }
      return;
    }

    if (mode === "review") {
      const owning = steps.find((s) => s.items.some((i) => i.unit_path === unitPath));
      if (owning) {
        setCursor(steps.indexOf(owning));
        setSelectedStep(owning.id);
      }
      return;
    }

    // Record: already sequenced → remove it, so a mis-click is undone by clicking again
    // rather than by hunting for the step in the list.
    const owning = steps.find((s) => s.items.some((i) => i.unit_path === unitPath));
    if (owning) {
      const remaining = owning.items.filter((i) => i.unit_path !== unitPath);
      setBusy("updating");
      try {
        if (remaining.length === 0) {
          setPlan(await call<Plan>(api(modelId, `steps/${owning.id}/`), { method: "DELETE" }));
        } else {
          setPlan(await call<Plan>(api(modelId, `steps/${owning.id}/items/`), {
            method: "PUT", body: JSON.stringify({ items: remaining }),
          }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update the step");
      } finally { setBusy(null); }
      return;
    }

    setBusy("adding");
    try {
      const d = await call<{ step_id: string; plan: Plan }>(api(modelId, "steps/"), {
        method: "POST",
        body: JSON.stringify({
          title: `Erect ${u.name}`,
          operation: "erect",
          items: [{ unit_path: unitPath }],
        }),
      });
      setPlan(d.plan);
      setSelectedStep(d.step_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the step");
    } finally { setBusy(null); }
  }, [mode, steps, unitByPath, modelId, selectedStep, pick3d]);

  const [depthBusy, setDepthBusy] = useState<string | null>(null);
  // Drag-and-drop reordering.
  //
  // The carried step lives in a REF as well as state. State drives the visual feedback,
  // but the drop handler must not read it: dragstart and drop can land in the same React
  // batch, and the drop closure then still sees null and silently does nothing. The ref is
  // set synchronously, so the drop always knows what it is holding.
  const dragIdRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  /**
   * Move one piece a level finer or coarser.
   *
   * The server does the whole thing — new palette AND the plan rebound onto it — so the
   * client never holds a moment where the steps point at pieces that no longer exist.
   */
  const changeDepth = useCallback(async (unitPath: string, direction: "inside" | "wider") => {
    setDepthBusy(unitPath);
    try {
      const d = await call<{
        units: Unit[]; instance_units: Record<string, string>; plan: Plan;
        rebound: { became: string[]; steps_touched: number; steps_removed: number };
      }>(api(modelId, "depth/"), {
        method: "POST",
        body: JSON.stringify({ unit_path: unitPath, direction }),
      });
      setUnits(d.units);
      setInstanceUnits(d.instance_units);
      setPlan(d.plan);
      // Follow the piece rather than leaving the selection on whatever index it was: after
      // a collapse the step the planner was editing may not exist any more.
      const landed = d.rebound.became[0];
      const owning = d.plan.steps.find((st) => st.items.some((i) => i.unit_path === landed));
      if (owning) {
        setSelectedStep(owning.id);
        if (mode === "review") setCursor(d.plan.steps.indexOf(owning));
      }
      if (d.rebound.steps_removed > 0) {
        setNotice(`${d.rebound.steps_removed} step(s) emptied by that and were removed.`);
      }
    } catch (e) {
      // The server refuses a depth change it cannot make cleanly (nothing deeper to open,
      // already the widest level) and leaves the plan untouched — surface its reason.
      const msg = e instanceof Error ? e.message : "Could not change the depth";
      setError(msg.replace(/^\d+\s*/, "").replace(/^\{"detail":"?/, "").replace(/"?\}$/, ""));
    } finally {
      setDepthBusy(null);
    }
  }, [modelId, mode]);

  const move = useCallback(async (stepId: string, delta: number) => {
    const i = steps.findIndex((s) => s.id === stepId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= steps.length) return;
    const order = steps.map((s) => s.id);
    [order[i], order[j]] = [order[j], order[i]];
    // Reorder locally first — a list that lags a click by a round trip feels broken.
    setPlan((p) => p && { ...p, steps: order.map((id, n) => {
      const s = steps.find((x) => x.id === id)!;
      return { ...s, seq: n + 1 };
    }) });
    try {
      setPlan(await call<Plan>(api(modelId, "steps/order/"), {
        method: "PUT", body: JSON.stringify({ step_ids: order }),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reorder");
      loadPlan();
    }
  }, [steps, modelId, loadPlan]);

  /** Drop `stepId` at `toIndex`, keeping everything else in order. */
  const moveTo = useCallback(async (stepId: string, toIndex: number) => {
    const from = steps.findIndex((s) => s.id === stepId);
    if (from < 0 || toIndex < 0 || toIndex >= steps.length || from === toIndex) return;
    const order = steps.map((s) => s.id);
    order.splice(toIndex, 0, order.splice(from, 1)[0]);
    setPlan((p) => p && { ...p, steps: order.map((id, n) => {
      const st = steps.find((x) => x.id === id)!;
      return { ...st, seq: n + 1 };
    }) });
    try {
      setPlan(await call<Plan>(api(modelId, "steps/order/"), {
        method: "PUT", body: JSON.stringify({ step_ids: order }),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reorder");
      loadPlan();
    }
  }, [steps, modelId, loadPlan]);

  /**
   * Move some of a step's pieces into their own lift.
   *
   * The sub-assembly this creates does not exist in the CAD — a big assembly's tree is
   * usually flat, so there is no five-or-six-way grouping to discover. The planner draws it.
   */
  const splitOut = useCallback(async (stepId: string, unitPaths: string[]) => {
    if (unitPaths.length === 0) return;
    setBusy("splitting");
    try {
      const d = await call<{ plan: Plan; new_step_id: string; moved: number;
                            source_removed: number }>(
        api(modelId, `steps/${stepId}/split-out/`), {
          method: "POST",
          body: JSON.stringify({ unit_paths: unitPaths, title: null }),
        });
      setPlan(d.plan);
      // Land on the new lift so it can be named straight away — that is the next thing
      // anyone wants to do with it.
      setSelectedStep(d.new_step_id);
      const idx = d.plan.steps.findIndex((st) => st.id === d.new_step_id);
      if (idx >= 0 && mode === "review") setCursor(idx);
      if (d.source_removed) {
        setNotice("That was every piece, so the step it came from was removed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move those pieces");
    } finally {
      setBusy(null);
    }
  }, [modelId, mode]);

  const removeStep = useCallback(async (stepId: string) => {
    setBusy("updating");
    try {
      setPlan(await call<Plan>(api(modelId, `steps/${stepId}/`), { method: "DELETE" }));
      if (selectedStep === stepId) setSelectedStep(null);
    } finally { setBusy(null); }
  }, [modelId, selectedStep]);

  const saveStep = useCallback(async (stepId: string, fields: Partial<Step>) => {
    setPlan(await call<Plan>(api(modelId, `steps/${stepId}/`), {
      method: "PUT", body: JSON.stringify(fields),
    }));
  }, [modelId]);

  const autoSequence = useCallback(async () => {
    if (steps.length && !confirm(
      `This replaces the ${steps.length} step(s) already recorded. Continue?`)) return;
    setBusy("auto");
    try {
      const d = await call<{ plan: Plan }>(api(modelId, "auto-sequence/"), { method: "POST" });
      setPlan(d.plan);
      setMode("review");
      setCursor(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build a draft");
    } finally { setBusy(null); }
  }, [modelId, steps.length]);

  const clearPlan = useCallback(async () => {
    if (!confirm("Delete the whole sequence and start again?")) return;
    setBusy("clearing");
    try {
      await fetch(api(modelId, "plan/"), { method: "DELETE" });
      await loadPlan();
      setCursor(0);
      setSelectedStep(null);
      setMode("record");
    } finally { setBusy(null); }
  }, [modelId, loadPlan]);

  // ── playback ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!playing || mode !== "review") return;
    if (cursor >= steps.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setCursor((c) => c + 1), 900);
    return () => clearTimeout(t);
  }, [playing, cursor, steps.length, mode]);

  // Scrubbing selects the step being shown — but ONLY when the scrubber actually moves.
  //
  // This used to re-run whenever `steps` changed, and every rename, split-out, depth change
  // and reorder rewrites `steps`. So the moment you edited anything the selection was
  // re-asserted onto whatever the scrubber happened to point at, and the editor silently
  // rebound to a different step. Typing a title then saved it to that other step: the lift
  // you were looking at kept its old name and some unrelated step got renamed. It read
  // exactly like "my changes don't persist".
  const syncedCursor = useRef<number | null>(null);
  useEffect(() => {
    if (mode !== "review") { syncedCursor.current = null; return; }
    if (syncedCursor.current === cursor) return;
    syncedCursor.current = cursor;
    const s = steps[cursor];
    if (s) setSelectedStep(s.id);
  }, [cursor, mode, steps]);

  // A tick set carried over from another step would move the wrong steel.
  useEffect(() => { setSelectedPieces(new Set()); setPick3d(false); }, [selectedStep]);

  // Keep the list on the step the viewer is showing. Scrubbing to step 34 of 67 while the
  // list sits at step 1 means the two halves of the screen describe different moments.
  useEffect(() => {
    const li = stepListRef.current?.children[shownIndex] as HTMLElement | undefined;
    li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [shownIndex]);

  // Arrow keys scrub. Ignored while a text field has focus, or typing a note would jump
  // the sequence around under the planner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (mode !== "review") return;
      if (e.key === "ArrowRight") setCursor((c) => Math.min(c + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setCursor((c) => Math.max(c - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, steps.length]);

  // ── exports ────────────────────────────────────────────────────────────────

  const download = (path: string) => {
    window.location.href = api(modelId, path);
  };

  const [pdfState, setPdfState] = useState<string | null>(null);

  const exportPdf = useCallback(async (withImages: boolean) => {
    const images: Record<string, string> = {};
    const wasMode = mode, wasCursor = cursor;
    try {
      if (withImages) {
        setMode("review");
        // Walk the sequence, letting each recolour paint before grabbing the canvas. The
        // capture is of the real view, so whatever the planner has framed is what prints.
        // One fixed framing for every step, deliberately. Zooming to each step's piece
        // makes a nicer single image but a worse document: the reader loses the sense of
        // the structure growing, and page 7 cannot be compared with page 8. Whatever the
        // planner has framed on screen is what the whole set prints at.
        for (let i = 0; i < steps.length; i++) {
          setPdfState(`Capturing step ${i + 1} of ${steps.length}…`);
          setCursor(i);
          // One frame for React to recolour the scene before the buffer is read.
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          await new Promise((r) => setTimeout(r, 120));
          const png = viewer.current?.capture({ print: true });
          if (png) images[steps[i].id] = png;
        }
      }
      setPdfState("Building the document…");
      const res = await fetch(api(modelId, "sequence.pdf/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, project_ref: projectRef ?? null }),
      });
      if (!res.ok) throw new Error(`PDF failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `erection_sequence_${projectRef ?? modelId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF");
    } finally {
      setPdfState(null);
      setMode(wasMode);
      setCursor(wasCursor);
      viewer.current?.reset();
    }
  }, [modelId, steps, mode, cursor, projectRef]);

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <p className="p-6 text-sm text-slate-500">Loading the plan…</p>;
  }

  const current = steps[shownIndex] ?? null;
  const editing = steps.find((s) => s.id === selectedStep) ?? null;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {(["record", "review"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); if (m === "review") setCursor(0); }}
              className={`px-3 py-1.5 text-sm capitalize transition ${
                mode === m ? "bg-slate-800 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-500">
          {mode === "record"
            ? "Click pieces in the 3D view in the order they go up. Click again to take one back out; shift-click to add it to the selected step as one lift."
            : "Scrub the sequence. ← → to step. Drag a step to reorder it."}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={autoSequence} disabled={!!busy}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {busy === "auto" ? "Drafting…" : "Draft from model"}
          </button>
          <button onClick={clearPlan} disabled={!!busy || steps.length === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Clear
          </button>
          <span className="mx-1 h-5 w-px bg-slate-300" />
          <button onClick={() => download("sequence.csv/")} disabled={steps.length === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            CSV
          </button>
          <button onClick={() => download("sequence.xlsx/")} disabled={steps.length === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Excel
          </button>
          <button onClick={() => exportPdf(true)} disabled={steps.length === 0 || !!pdfState}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {pdfState ?? "PDF with views"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-amber-700 hover:text-amber-950">×</button>
        </div>
      )}

      {/* A depth change can delete steps. Say so — steps vanishing unannounced reads as
          data loss even when it is exactly what was asked for. */}
      {notice && (
        <div className="flex items-start gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate-500 hover:text-slate-900">×</button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_26rem]">
        {/* 3D + scrubber */}
        <div className="flex min-h-0 flex-col gap-2">
          <SequenceViewer
            ref={viewer}
            modelId={modelId}
            instanceUnits={instanceUnits}
            stateByUnit={stateByUnit}
            onPick={pick}
            className="min-h-[24rem] flex-1"
          />

          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setMode("review"); setCursor((c) => Math.max(c - 1, 0)); }}
                disabled={steps.length === 0}
                className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40">←</button>
              <button
                onClick={() => { setMode("review"); setPlaying((p) => !p); }}
                disabled={steps.length === 0}
                className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40">
                {playing ? "❚❚" : "▶"}
              </button>
              <button
                onClick={() => { setMode("review"); setCursor((c) => Math.min(c + 1, steps.length - 1)); }}
                disabled={steps.length === 0}
                className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40">→</button>

              <input
                type="range" min={0} max={Math.max(steps.length - 1, 0)} value={Math.min(cursor, Math.max(steps.length - 1, 0))}
                onChange={(e) => { setMode("review"); setCursor(Number(e.target.value)); }}
                disabled={steps.length === 0}
                className="flex-1 accent-orange-500"
              />

              <span className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-500">
                {steps.length === 0 ? "no steps"
                  : mode === "record" ? `${steps.length} recorded`
                  : `step ${cursor + 1} / ${steps.length}`}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
              <span><b className="text-slate-900">{kg(totals.erected)}</b> erected of {kg(totals.all)}</span>
              {current && (
                <span className="text-orange-600">
                  now: {current.title ?? "—"} · {kg(
                    current.items.reduce((a, i) => a + (unitByPath[i.unit_path]?.mass_kg ?? 0), 0))}
                </span>
              )}
              {totals.unsequenced > 0 && (
                <span className="text-amber-700">{totals.unsequenced} piece(s) not sequenced</span>
              )}
              {totals.incomplete && (
                <span className="text-amber-700">
                  some weights unknown — do not size lifting gear from this
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Steps + editor.
            The list keeps a floor and the editor a ceiling, so opening a step can never
            push the sequence off the screen — which is exactly what it did when the editor
            was free to grow with a hundred-piece lift. */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-[12rem] flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Sequence</span>
              <span>{steps.length} step{steps.length === 1 ? "" : "s"}</span>
            </div>

            {steps.length === 0 && (
              <p className="p-4 text-sm text-slate-500">
                Nothing sequenced yet. Click a piece in the 3D view, or use
                <b> Draft from model</b> to lay every piece out lowest-first and rearrange from there.
              </p>
            )}

            <ul ref={stepListRef} className="divide-y divide-slate-100">
              {steps.map((s, i) => {
                const mass = s.items.reduce(
                  (a, it) => a + (unitByPath[it.unit_path]?.mass_kg ?? 0), 0);
                const gone = s.items.filter((it) => !unitByPath[it.unit_path]).length;
                const isNow = i === shownIndex;
                return (
                  <li
                    key={s.id}
                    draggable
                    onDragStart={(e) => {
                      dragIdRef.current = s.id;
                      setDragId(s.id);
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox will not start a drag without data on the transfer.
                      e.dataTransfer.setData("text/plain", s.id);
                    }}
                    onDragOver={(e) => {
                      if (!dragIdRef.current) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overIndex !== i) setOverIndex(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const held = dragIdRef.current;
                      dragIdRef.current = null;
                      if (held) moveTo(held, i);
                      setDragId(null);
                      setOverIndex(null);
                    }}
                    onDragEnd={() => {
                      dragIdRef.current = null;
                      setDragId(null);
                      setOverIndex(null);
                    }}
                    onClick={() => { setSelectedStep(s.id); setMode("review"); setCursor(i); }}
                    className={`cursor-pointer px-3 py-2 transition ${
                      dragId === s.id ? "opacity-40" : ""
                    } ${
                      overIndex === i && dragId && dragId !== s.id
                        ? "border-t-2 border-orange-500" : ""
                    } ${
                      isNow ? "bg-orange-50" : selectedStep === s.id ? "bg-slate-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 cursor-grab select-none text-xs text-slate-300 active:cursor-grabbing"
                        title="Drag to reorder"
                      >⠿</span>
                      <span className={`mt-0.5 w-6 shrink-0 text-right text-xs font-semibold tabular-nums ${
                        isNow ? "text-orange-600" : "text-slate-400"}`}>{s.seq}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-slate-800">{s.title || "(untitled)"}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span className="uppercase">{s.operation ?? "erect"}</span>
                          {s.zone && <span>· {s.zone}</span>}
                          <span>· {kg(mass)}</span>
                          {s.items.length > 1 && <span>· {s.items.length} pieces</span>}
                          {s.hold_point && <span className="font-semibold text-amber-700">· HOLD</span>}
                          {gone > 0 && (
                            <span className="font-semibold text-amber-700">
                              · {gone} piece(s) missing from model
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col">
                        <button onClick={(e) => { e.stopPropagation(); move(s.id, -1); }}
                          disabled={i === 0}
                          className="px-1 text-xs text-slate-400 hover:text-slate-800 disabled:opacity-25">▲</button>
                        <button onClick={(e) => { e.stopPropagation(); move(s.id, 1); }}
                          disabled={i === steps.length - 1}
                          className="px-1 text-xs text-slate-400 hover:text-slate-800 disabled:opacity-25">▼</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {editing ? (
            <StepEditor
              key={editing.id}
              step={editing}
              units={editing.items.map((i) => unitByPath[i.unit_path]).filter(Boolean)}
              operations={OPERATIONS}
              onSave={(f) => saveStep(editing.id, f)}
              onDelete={() => removeStep(editing.id)}
              canExtend={mode === "record"}
              onZoom={() => viewer.current?.focus(editing.items.map((i) => i.unit_path))}
              onDepth={changeDepth}
              depthBusy={depthBusy}
              onSplitOut={(paths) => splitOut(editing.id, paths)}
              selected={selectedPieces}
              setSelected={setSelectedPieces}
              pick3d={pick3d}
              setPick3d={setPick3d}
            />
          ) : (
            <div className="shrink-0 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-sm text-slate-400">
              Select a step to add method notes, plant, crew and hold points.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
