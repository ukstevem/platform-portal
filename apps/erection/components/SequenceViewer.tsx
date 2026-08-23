"use client";

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";

/**
 * The 3D half of the planner: the whole structure, every part coloured by where it sits in
 * the sequence.
 *
 * The scene is built ONCE and only ever recoloured. Rebuilding it per step would refetch
 * 159 prototype meshes on every arrow-key press, and a sequence you cannot scrub is a
 * sequence nobody checks.
 *
 * Colour is the entire language of the view:
 *   erected      what is already standing when this step starts — solid, muted
 *   current      what this step puts up — bright, and the only thing that reads as "now"
 *   picked       ticked for moving into its own lift — must be told apart from the rest of
 *                the step it is still in, or you cannot see what you have chosen
 *   current-muted the rest of that step while a selection is being made. Three picked pieces
 *                in a hundred-piece lift are a few pixels; dropping the rest back is what
 *                makes them findable without zooming in
 *   future       not yet erected — ghosted, so context is visible without competing
 *   unsequenced  in the model but in no step — amber, because that is a planning gap
 */

export type UnitState = "erected" | "current" | "current-muted" | "picked" | "future" | "unsequenced";

export type ViewerHandle = {
  /**
   * PNG data-URL of the current view. ``print`` re-renders on a light ground with
   * paper-legible colours first — the on-screen dark palette turns the already-erected
   * context, which is the whole point of a step view, into near-black on near-black.
   */
  capture: (opts?: { print?: boolean }) => string | null;
  setView: (v: "iso" | "front" | "side" | "top") => void;
  /** Regroup the drawn meshes after a depth change, without refetching geometry. */
  remap: (instanceUnits: Record<string, string>, states: Record<string, UnitState>) => void;
  /** Frame the camera on one piece, so a step's subject is actually visible. */
  focus: (unitPaths: string[]) => void;
  reset: () => void;
};

type Inst = {
  instance_id: string;
  prototype_key: string;
  node_type: string | null;
  world_placement: number[] | null;
};

const STATE_COLOUR: Record<UnitState, number> = {
  erected: 0x8b98a5,
  current: 0xf97316,
  "current-muted": 0x7a4a24,
  picked: 0x22d3ee,     // cyan — reads clearly against the orange of the step it sits in
  future: 0x2f3f4d,
  unsequenced: 0xd9a441,
};

const STATE_OPACITY: Record<UnitState, number> = {
  erected: 1,
  current: 1,
  "current-muted": 0.45,
  picked: 1,
  future: 0.12,
  unsequenced: 0.55,
};

// Paper palette. Ink is dark on light, and a printed sheet has none of a screen's dynamic
// range, so the erected structure has to be solid and mid-toned and the not-yet-erected
// still faintly visible rather than a shade of black.
const PRINT_BG = 0xf4f6f8;
const PRINT_COLOUR: Record<UnitState, number> = {
  erected: 0x6b7885,
  current: 0xe4610f,
  // Picking is an authoring state, never a documented one — a printed sheet shows the lift
  // as it will be built, not what happened to be ticked when the PDF was made.
  "current-muted": 0xe4610f,
  picked: 0xe4610f,
  future: 0xc3ccd4,
  unsequenced: 0xc99a2e,
};
const PRINT_OPACITY: Record<UnitState, number> = {
  erected: 1,
  current: 1,
  "current-muted": 1,
  picked: 1,
  future: 0.4,
  unsequenced: 0.75,
};

// Meshes are fetched one per distinct prototype, not per instance — a handrail run is four
// shapes placed sixty times. Six at a time keeps well under the browser's per-origin
// connection limit while still finishing a 159-prototype model in a few seconds.
const MESH_CONCURRENCY = 6;

/**
 * A content signature for the instance→unit map.
 *
 * The scene must rebuild when the mapping genuinely changes (a path was split into its
 * children) but NOT when an equal-valued object merely arrives with a new identity — which
 * it does every time the plan reloads. Keying the build on object identity meant each
 * reload cancelled the in-flight build moments after it had appended its canvas, so the
 * viewer sat at the default 300x150 and rendered nothing at all.
 */
function signature(map: Record<string, string>): string {
  const keys = Object.keys(map);
  let h = 0x811c9dc5;                       // FNV-1a
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const k of keys) {
    // Length-prefixed, so "ab"+"c" and "a"+"bc" cannot hash alike without a separator
    // character that a path might legitimately contain.
    mix(String(k.length));
    mix(k);
    mix(map[k] ?? "");
  }
  return `${keys.length}:${(h >>> 0).toString(36)}`;
}

export const SequenceViewer = forwardRef<ViewerHandle, {
  modelId: string;
  instanceUnits: Record<string, string>;
  stateByUnit: Record<string, UnitState>;
  onPick?: (unitPath: string, opts: { shift: boolean }) => void;
  className?: string;
}>(function SequenceViewer(
  { modelId, instanceUnits, stateByUnit, onPick, className }, ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<{
    dispose: () => void;
    recolour: (s: Record<string, UnitState>) => void;
    remap: (m: Record<string, string>, states: Record<string, UnitState>) => void;
    capture: (opts?: { print?: boolean }) => string | null;
    setView: (v: string) => void;
    focus: (paths: string[]) => void;
    reset: () => void;
  } | null>(null);

  // React StrictMode invokes the build effect twice in dev, and the build is async: two
  // runs would race over the same host element, leaving one WebGL context and RAF loop
  // orphaned and the visible canvas belonging to a renderer nobody sizes. A generation
  // token makes every stale run abandon its work at the next checkpoint.
  const generation = useRef(0);

  const unitsSig = useMemo(() => signature(instanceUnits), [instanceUnits]);
  // Read through a ref so the build closure sees the current map without the map's
  // identity being a rebuild trigger.
  const unitsRef = useRef(instanceUnits);
  unitsRef.current = instanceUnits;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [missing, setMissing] = useState(0);

  // Held in a ref so the click handler always sees the latest callback without the scene
  // being torn down and rebuilt whenever the parent re-renders.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useImperativeHandle(ref, () => ({
    capture: (opts) => scene.current?.capture(opts) ?? null,
    setView: (v) => scene.current?.setView(v),
    remap: (m, states) => scene.current?.remap(m, states),
    focus: (paths) => scene.current?.focus(paths),
    reset: () => scene.current?.reset(),
  }), []);

  const build = useCallback(async () => {
    const gen = ++generation.current;
    const stale = () => generation.current !== gen;

    setStatus("loading");
    setMissing(0);

    let instances: Inst[] = [];
    try {
      const res = await fetch(`/erection/api/cad/models/${modelId}/scene/`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      instances = (await res.json()).instances ?? [];
    } catch {
      if (!stale()) setStatus("error");
      return;
    }
    if (stale()) return;

    const THREE = await import("three");
    const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
    if (stale() || !host.current) return;

    scene.current?.dispose();
    const el = host.current;
    el.innerHTML = "";

    // preserveDrawingBuffer so toDataURL returns pixels rather than a blank canvas — the
    // PDF's step images depend on it.
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Let CSS own the canvas box and give three.js only the drawing-buffer size
    // (updateStyle=false). The canvas then fills its container even in the frame before
    // the first measurement lands, instead of sitting at the 300x150 default.
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    el.appendChild(renderer.domElement);

    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x111820);
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
    cam.up.set(0, 0, 1); // CAD is Z-up
    const ctrl = new OrbitControls(cam, renderer.domElement);
    ctrl.enableDamping = true;

    sc.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(1, 1.3, 1.4);
    sc.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.28);
    fill.position.set(-1, -0.8, 0.4);
    sc.add(fill);

    const root = new THREE.Group();
    sc.add(root);

    // Fetch each distinct prototype's mesh once, in a small pool.
    const keys = Array.from(new Set(instances.map((i) => i.prototype_key)));
    setProgress({ done: 0, total: keys.length });
    const geo = new Map<string, { v: number[]; f: number[] }[]>();
    let done = 0;
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= keys.length) return;
        const k = keys[i];
        // Retry a failed mesh: a dropped fetch here is a piece of steel missing from the
        // structure, and a viewer that quietly omits parts is worse than one that fails
        // loudly. The proxy retries the connection too; this covers the rest.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const m = await fetch(
              `/erection/api/cad/models/${modelId}/prototype/${k}/mesh/?lod=5`,
              { cache: "force-cache" });
            if (m.ok) {
              geo.set(k, (await m.json()).bodies ?? []);
              break;
            }
            // 4xx is a real answer — the prototype has no mesh. Retrying wastes time.
            if (m.status < 500) break;
          } catch {
            /* fall through to the retry */
          }
          if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
        done++;
        if (done % 5 === 0 || done === keys.length) setProgress({ done, total: keys.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(MESH_CONCURRENCY, keys.length) }, worker));
    if (stale()) {
      // A newer build owns the element now — drop this one's GPU resources rather than
      // leaving a second context and animation loop running behind the visible canvas.
      renderer.dispose();
      return;
    }

    // One material per unit, shared by all that unit's meshes: recolouring a step is then a
    // handful of material writes rather than a walk over thousands of meshes.
    const materials = new Map<string, InstanceType<typeof THREE.MeshLambertMaterial>>();
    const unitBoxes = new Map<string, InstanceType<typeof THREE.Box3>>();
    // Every drawn mesh with the instance it came from. Changing a piece's DEPTH changes
    // which unit an instance belongs to but not its geometry, so this lets the scene be
    // regrouped in place instead of refetching 148 meshes — a rebuild costs ~33s, which
    // would make the depth control unusable.
    const drawn: { mesh: InstanceType<typeof THREE.Mesh>; instanceId: string }[] = [];
    let unmeshed = 0;

    for (const inst of instances) {
      const bodies = geo.get(inst.prototype_key);
      const unit = unitsRef.current[inst.instance_id];
      if (!bodies?.length || !unit) {
        // A `part_no_solid` entity — a sketch skeleton, an empty compound — has no geometry
        // to draw and never did. Counting those as "could not be drawn" put a permanent
        // amber warning on a model that was in fact drawn completely, and a warning that is
        // always wrong is one nobody reads when it is finally right.
        if (!bodies?.length && inst.node_type !== "part_no_solid") unmeshed++;
        continue;
      }
      let mat = materials.get(unit);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({
          color: STATE_COLOUR.future, transparent: true, opacity: STATE_OPACITY.future,
        });
        materials.set(unit, mat);
      }
      for (const b of bodies) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(b.v, 3));
        g.setIndex(b.f);
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, mat);
        if (inst.world_placement) {
          mesh.applyMatrix4(new THREE.Matrix4().fromArray(inst.world_placement));
        }
        mesh.userData.unit = unit;
        root.add(mesh);
        drawn.push({ mesh, instanceId: inst.instance_id });

        const box = new THREE.Box3().setFromObject(mesh);
        const existing = unitBoxes.get(unit);
        if (existing) existing.union(box);
        else unitBoxes.set(unit, box.clone());
      }
    }
    setMissing(unmeshed);

    const whole = new THREE.Box3().setFromObject(root);
    const centre = whole.isEmpty()
      ? new THREE.Vector3() : whole.getCenter(new THREE.Vector3());
    const size = whole.isEmpty()
      ? new THREE.Vector3(1, 1, 1) : whole.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) || 1;
    cam.near = radius / 2000;
    cam.far = radius * 200;

    const frame = (target: InstanceType<typeof THREE.Vector3>, r: number, v = "iso") => {
      const d = Math.max(r, radius * 0.05) * 2.1;
      const pos: Record<string, [number, number, number]> = {
        iso: [d * 0.8, -d * 0.8, d * 0.6],
        front: [0, -d, 0],
        side: [d, 0, 0],
        top: [0, 0, d],
      };
      const [x, y, z] = pos[v] ?? pos.iso;
      cam.position.set(target.x + x, target.y + y, target.z + z);
      cam.updateProjectionMatrix();
      ctrl.target.copy(target);
      ctrl.update();
    };
    let lastView = "iso";
    frame(centre, radius, "iso");

    // Picking. A drag that ends on a mesh is a camera move, not a selection, so only a
    // near-stationary press counts as a click.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const start = downAt;
      downAt = null;
      if (!start || e.button !== 0) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 25) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, cam);
      const hits = ray.intersectObjects(root.children, false);
      // Ghosted future parts stay clickable — picking the next thing to erect out of what
      // is NOT yet up is the main way a sequence gets built.
      const hit = hits.find((h) => h.object.userData?.unit);
      // Shift is the 'same lift' modifier: it folds the piece into the step already
      // selected instead of starting a new one.
      if (hit) pickRef.current?.(hit.object.userData.unit as string, { shift: e.shiftKey });
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let sizedW = 0, sizedH = 0;
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h || (w === sizedW && h === sizedH)) return;
      sizedW = w; sizedH = h;
      renderer.setSize(w, h, false);   // false: CSS already sizes the element
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // Re-check every frame. It is two integer reads and a comparison, and it means a
      // container that was still zero-height at build time (a panel that had not been laid
      // out yet) corrects itself on the next frame rather than staying 300x150 forever.
      fit();
      ctrl.update();
      renderer.render(sc, cam);
    };
    loop();

    // The state map the scene is currently painted with, so a print capture can repaint
    // from it and then repaint back.
    let lastStates: Record<string, UnitState> = {};

    scene.current = {
      dispose: () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        ctrl.dispose();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointerup", onUp);
        root.traverse((o) => {
          const m = o as unknown as { geometry?: { dispose(): void } };
          m.geometry?.dispose();
        });
        materials.forEach((m) => m.dispose());
        renderer.dispose();
      },
      remap: (map, states) => {
        // Reassign every mesh to its new unit's material. Geometry, placements and the
        // camera are untouched — only the grouping changed.
        const fresh = new Map<string, InstanceType<typeof THREE.MeshLambertMaterial>>();
        unitBoxes.clear();
        for (const { mesh, instanceId } of drawn) {
          const unit = map[instanceId];
          if (!unit) continue;
          let mat = fresh.get(unit);
          if (!mat) {
            // Reuse the existing material where the unit survived the change, so its
            // current colour does not flash before the recolour below lands.
            mat = materials.get(unit) ?? new THREE.MeshLambertMaterial({
              color: STATE_COLOUR.future, transparent: true, opacity: STATE_OPACITY.future,
            });
            fresh.set(unit, mat);
          }
          mesh.material = mat;
          mesh.userData.unit = unit;
          const box = new THREE.Box3().setFromObject(mesh);
          const existing = unitBoxes.get(unit);
          if (existing) existing.union(box);
          else unitBoxes.set(unit, box.clone());
        }
        // Dispose materials for units that no longer exist, or a long session of depth
        // changes leaks one GPU material per abandoned piece.
        for (const [unit, mat] of materials) {
          if (!fresh.has(unit)) mat.dispose();
        }
        materials.clear();
        for (const [unit, mat] of fresh) materials.set(unit, mat);
        scene.current?.recolour(states);
      },
      recolour: (states) => {
        lastStates = states;
        materials.forEach((mat, unit) => {
          const st = states[unit] ?? "unsequenced";
          mat.color.setHex(STATE_COLOUR[st]);
          mat.opacity = STATE_OPACITY[st];
          // A fully opaque material still blends when transparent is left on, which makes
          // erected steel look washed out against the ghosts behind it.
          mat.transparent = STATE_OPACITY[st] < 1;
          mat.depthWrite = STATE_OPACITY[st] >= 1;
          mat.needsUpdate = true;
        });
      },
      capture: (opts) => {
        // Render synchronously first: toDataURL reads the buffer as it stands, and the RAF
        // loop may not have drawn since the last recolour.
        fit();
        const paper = !!opts?.print;
        const marks: InstanceType<typeof THREE.Box3Helper>[] = [];
        if (paper) {
          sc.background = new THREE.Color(PRINT_BG);
          materials.forEach((mat, unit) => {
            const st = lastStates[unit] ?? "unsequenced";
            mat.color.setHex(PRINT_COLOUR[st]);
            mat.opacity = PRINT_OPACITY[st];
            mat.transparent = PRINT_OPACITY[st] < 1;
            mat.depthWrite = PRINT_OPACITY[st] >= 1;
            mat.needsUpdate = true;
          });

          // Box the step's own pieces. The framing is deliberately the same on every page
          // so the structure can be seen growing, but that makes a 13 kg connection stub a
          // few orange pixels in a 7-metre frame — findable only if something points at it.
          for (const [unit, st] of Object.entries(lastStates)) {
            if (st !== "current") continue;
            const b = unitBoxes.get(unit);
            if (!b) continue;
            // Inflate slightly so the box reads as an annotation around the piece rather
            // than as extra steelwork skinned tight to it.
            const box = b.clone();
            const pad = Math.max(box.getSize(new THREE.Vector3()).length() * 0.12, radius * 0.012);
            box.expandByScalar(pad);
            const helper = new THREE.Box3Helper(box, new THREE.Color(PRINT_COLOUR.current));
            (helper.material as InstanceType<typeof THREE.LineBasicMaterial>).depthTest = false;
            helper.renderOrder = 999;
            sc.add(helper);
            marks.push(helper);
          }
        }
        renderer.render(sc, cam);
        let url: string | null = null;
        try {
          url = renderer.domElement.toDataURL("image/png");
        } catch {
          url = null;
        }
        if (paper) {
          // Always put the screen back, even if the capture failed — a viewer left in
          // paper colours would look like the app had broken.
          for (const m of marks) {
            sc.remove(m);
            m.geometry.dispose();
            (m.material as InstanceType<typeof THREE.LineBasicMaterial>).dispose();
          }
          sc.background = new THREE.Color(0x111820);
          scene.current?.recolour(lastStates);
          renderer.render(sc, cam);
        }
        return url;
      },
      setView: (v) => { lastView = v; frame(ctrl.target.clone(), radius, v); },
      focus: (paths) => {
        const box = new THREE.Box3();
        let any = false;
        for (const p of paths) {
          const b = unitBoxes.get(p);
          if (b) { box.union(b); any = true; }
        }
        if (!any) return;
        const c = box.getCenter(new THREE.Vector3());
        const s = box.getSize(new THREE.Vector3());
        frame(c, Math.max(s.x, s.y, s.z) || radius * 0.1, lastView);
      },
      reset: () => frame(centre, radius, lastView),
    };

    scene.current.recolour(stateByUnit);
    setStatus("ready");
    // Only modelId rebuilds. stateByUnit is applied here and by the recolour effect below;
    // instanceUnits changes are handled by the remap effect, which regroups the meshes
    // already on the GPU rather than refetching them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  useEffect(() => {
    build();
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [build]);

  useEffect(() => {
    scene.current?.recolour(stateByUnit);
  }, [stateByUnit]);

  // A depth change rewrites which unit each instance belongs to. Regroup in place — the
  // geometry is identical, and a rebuild would cost the full mesh fetch (~33s) for what is
  // really just a change of grouping. Skipped on the first pass: the build already applied
  // the map it was given.
  const builtSig = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "ready") return;
    if (builtSig.current === null) { builtSig.current = unitsSig; return; }
    if (builtSig.current === unitsSig) return;
    builtSig.current = unitsSig;
    scene.current?.remap(instanceUnits, stateByUnit);
    // stateByUnit is read for the repaint that follows the regroup; it must not re-trigger
    // this effect, which is keyed on the mapping alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsSig, status]);

  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-700 bg-[#111820] ${className ?? ""}`}>
      <div ref={host} className="h-full w-full" />

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-300">
          <span>Building the model…</span>
          {progress.total > 0 && (
            <span className="text-xs text-slate-500">
              {progress.done} / {progress.total} shapes
            </span>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-amber-300">
          Could not load this model&apos;s geometry.
        </div>
      )}

      {status === "ready" && (
        <>
          <div className="absolute right-2 top-2 flex gap-1">
            {(["iso", "front", "side", "top"] as const).map((v) => (
              <button
                key={v}
                onClick={() => scene.current?.setView(v)}
                className="rounded border border-slate-600 bg-slate-800/85 px-2 py-1 text-xs capitalize text-slate-200 hover:bg-slate-700"
              >
                {v}
              </button>
            ))}
            <button
              onClick={() => scene.current?.reset()}
              className="rounded border border-slate-600 bg-slate-800/85 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              Fit
            </button>
          </div>

          {/* A model drawn with pieces missing must never look complete. */}
          {missing > 0 && (
            <div className="absolute left-2 top-2 rounded bg-amber-500/90 px-2 py-1 text-xs font-medium text-amber-950">
              {missing} part{missing === 1 ? "" : "s"} could not be drawn
            </div>
          )}
        </>
      )}
    </div>
  );
});
