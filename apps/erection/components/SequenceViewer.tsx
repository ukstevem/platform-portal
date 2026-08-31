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
  /**
   * Regroup the drawn meshes without refetching geometry. Returns false when the new map
   * contains instances that are not drawn (a restore) — those need a full rebuild, because
   * their buffers were disposed when they were suppressed.
   */
  remap: (instanceUnits: Record<string, string>, states: Record<string, UnitState>) => boolean;
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
 * Hard ceiling on drawn meshes.
 *
 * A backstop, not a design: with per-solid selection and shared geometry a real model sits
 * far below it. It exists so that no model can ever lock the tab up again — and when it
 * bites, the viewer says how much it is not showing rather than quietly drawing a partial
 * structure that looks whole.
 */
const MAX_MESHES = 60000;

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
    remap: (m: Record<string, string>, states: Record<string, UnitState>) => boolean;
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
  const [skipped, setSkipped] = useState(0);
  // Parts the model has but the plan put out of scope. Reported rather than silently dropped:
  // a viewer showing less than the model holds should say so.
  const [outOfScope, setOutOfScope] = useState(0);

  // Held in a ref so the click handler always sees the latest callback without the scene
  // being torn down and rebuilt whenever the parent re-renders.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useImperativeHandle(ref, () => ({
    capture: (opts) => scene.current?.capture(opts) ?? null,
    setView: (v) => scene.current?.setView(v),
    remap: (m, states) => scene.current?.remap(m, states) ?? false,
    focus: (paths) => scene.current?.focus(paths),
    reset: () => scene.current?.reset(),
  }), []);

  const build = useCallback(async () => {
    const gen = ++generation.current;
    const stale = () => generation.current !== gen;

    setStatus("loading");
    setMissing(0);
    setSkipped(0);
    setOutOfScope(0);

    let instances: Inst[] = [];
    try {
      const res = await fetch(`/erection/api/cad/models/${modelId}/scene/`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      instances = (await res.json()).instances ?? [];
      // /scene/ is the WHOLE model. instanceUnits is the palette, and a suppressed piece is
      // absent from it - that is how scope leaves the view. Without this filter the viewer
      // fetched a mesh for every prototype in the model however far out of scope it was: on job
      // 10335 that means the 13,839-solid plant body and a 200 t pipe run, which drove the API
      // to 13.6 GiB, killed it mid-load, and left the progress counter stuck partway.
      //
      // Only filter once the palette has arrived. An empty map means "not loaded yet", not
      // "nothing is in scope", and treating those the same would render an empty model.
      const inScope = unitsRef.current;
      if (Object.keys(inScope).length > 0) {
        const before = instances.length;
        instances = instances.filter((i) => inScope[i.instance_id] !== undefined);
        if (!stale()) setOutOfScope(before - instances.length);
      }
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
    // No vertical stop. OrbitControls clamps the polar angle to [0, PI] by default, which in
    // this Z-up scene means the orbit jams the moment the camera reaches straight-down or
    // straight-up. You cannot carry on over the top of a frame to pick it up from the far
    // side, and that is exactly the move someone makes to check a brace lands where they
    // think it does. Dropping the configured limit lets the orbit run right up to both poles.
    //
    // It still cannot run THROUGH one. OrbitControls calls Spherical.makeSafe() immediately
    // after this clamp, which pins the polar angle to within 1e-6 rad of each pole whatever
    // is set here, and that is deliberate: cam.up is fixed at +Z, so crossing a pole would
    // snap the whole view 180 degrees about the sight line. An epsilon short of vertical is
    // as close to unrestricted as this control goes, and it does not read as a stop.
    ctrl.minPolarAngle = -Infinity;
    ctrl.maxPolarAngle = Infinity;
    // Damping off, because it kept the model turning after the mouse button came up: a small
    // nudge to look at one connection carried on past it and had to be nudged back. Motion
    // now ends with the drag. The RAF loop still calls ctrl.update() every frame, which is
    // what applies a zoom or a pan; with damping off it simply has no coast left to settle.
    ctrl.enableDamping = false;

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
        // "default", NOT "force-cache". A mesh only changes when the model does, so a warm
        // cache is still the difference between a scene that paints and one that
        // re-tessellates — but force-cache is defined as returning a stored match "fresh or
        // stale" WITHOUT asking the server, and the mesh URL does not change when the geometry
        // does. So when the box proxy changed from axis-aligned to ORIENTED, every browser
        // that had already loaded the model kept drawing the old boxes, and no refresh could
        // clear it (a reload does not override an explicit fetch cache mode). The API now sends
        // an ETag with Cache-Control: no-cache, so "default" revalidates: a 304 when the
        // geometry is unchanged, which is nearly free, and fresh bytes the moment it is not.
        //
        // The retry stays. An EMPTY result from cache is not an answer, it is a poisoned entry
        // — when the API was being OOM-killed the browser cached the failures and every later
        // load replayed them, so the viewer reported all 291 parts undrawable. If cache gives
        // us nothing, ask again bypassing it: self-healing rather than something only clearing
        // site data can fix.
        for (let attempt = 0; attempt < 3; attempt++) {
          const mode: RequestCache = attempt === 0 ? "default" : "reload";
          try {
            const m = await fetch(
              // proxy=false: above 400 solids the API serves convex HULLS by default, and a
              // hull fills a channel's opening exactly as a box does. Neither can show what a
              // member IS, which is what an erection planner is looking at the model to find
              // out. lod=15 keeps it affordable: 2.9 M triangles for 10335 against 7.3 M at
              // review deflection, and a 15 mm chord error is invisible on a 180 mm channel.
              `/erection/api/cad/models/${modelId}/prototype/${k}/mesh/?lod=15&proxy=false`,
              { cache: mode });
            if (m.ok) {
              const bodies = (await m.json()).bodies ?? [];
              if (bodies.length) {
                geo.set(k, bodies);
                break;
              }
              // Empty on the LAST attempt is a real answer (a part with no solid); empty from
              // cache is not to be trusted, so fall through and re-ask the server.
              if (attempt === 2) {
                geo.set(k, bodies);
                break;
              }
              continue;
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
    // One geometry per (prototype, body), shared by every instance that uses it.
    const geomCache = new Map<string, InstanceType<typeof THREE.BufferGeometry>>();
    let unmeshed = 0;
    let overBudget = 0;

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
      // An instance id ending ":sN" is ONE SOLID of an exploded assembly (the same
      // convention as cas_member_instance's `{assembly_key}:s{seq}`). Every such instance
      // shares the parent's prototype and its identity placement, so drawing all of the
      // prototype's bodies for each of them draws the whole assembly once per solid, on
      // top of itself.
      //
      // On job 10335 that is a prototype of 13,839 solids instanced 13,839 times:
      // 191,517,921 meshes and 4.95 BILLION triangles. The tab does not error, it locks up
      // and dies. Drawn correctly it is 13,839 meshes — one body each.
      const solid = /:s(\d+)$/.exec(inst.instance_id);
      const chosen = solid
        ? (bodies[Number(solid[1])] ? [{ b: bodies[Number(solid[1])], i: Number(solid[1]) }] : [])
        : bodies.map((b, i) => ({ b, i }));

      for (const { b, i: bodyIndex } of chosen) {
        if (drawn.length >= MAX_MESHES) { overBudget++; continue; }

        // Geometry is shared per (prototype, body): 700 identical washers were uploading
        // 700 copies of the same buffer to the GPU. Only the transform differs per
        // instance, and applyMatrix4 on a Mesh sets its matrix, never the geometry.
        const gk = `${inst.prototype_key}#${bodyIndex}`;
        let g = geomCache.get(gk);
        if (!g) {
          g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(b.v, 3));
          g.setIndex(b.f);
          g.computeVertexNormals();
          geomCache.set(gk, g);
        }
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
    setSkipped(overBudget);

    // Mutable: suppressing most of a plant changes the extent of the scene, so the centre
    // and radius the camera works from have to be recomputed rather than fixed at build.
    let centre = new THREE.Vector3();
    let radius = 1;
    const measure = () => {
      const whole = new THREE.Box3().setFromObject(root);
      centre = whole.isEmpty() ? new THREE.Vector3() : whole.getCenter(new THREE.Vector3());
      const size = whole.isEmpty()
        ? new THREE.Vector3(1, 1, 1) : whole.getSize(new THREE.Vector3());
      radius = Math.max(size.x, size.y, size.z) || 1;
      cam.near = radius / 2000;
      cam.far = radius * 200;
      cam.updateProjectionMatrix();
    };
    measure();

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
      // Put up back to +Z. Orbiting over a pole negates it (see crossPole below), and a
      // named view taken while it is inverted comes out rolled 180 degrees. Reasserting it
      // here makes every toolbar button - and Fit - double as the way back to level, so a
      // planner who has tumbled the model and lost their bearings is one click from
      // straight again.
      //
      // Top is the degenerate one: [0, 0, d] puts the camera exactly on the +Z axis with up
      // along it too, which leaves the roll undefined. It survives only because ctrl.update()
      // runs makeSafe(), which nudges the polar angle 1e-6 off the pole before lookAt is
      // applied. That was already the case before any of this; setting up here restores the
      // same starting condition rather than introducing a new one.
      cam.up.set(0, 0, 1);
      ctrl.target.copy(target);
      ctrl.update();
    };
    let lastView = "iso";
    // Re-measure and re-frame. Called after a remap removes meshes, so the camera is fitted
    // to what is actually there rather than to the extent of things that have gone.
    const refit = () => { measure(); frame(centre, radius, lastView); };
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

    // Orbiting over the poles.
    //
    // OrbitControls cannot orbit THROUGH a pole. Whatever minPolarAngle and maxPolarAngle
    // are set to, update() finishes with Spherical.makeSafe(), which pins the polar angle to
    // within 1e-6 rad of straight-down and straight-up. The orbit stops dead there, so you
    // cannot carry on over the top of a frame to come at it from the far side - which is the
    // move someone makes to check what a brace actually lands on.
    //
    // So the camera is hopped across the pole here instead. When a drag has it pinned and is
    // still pushing further in, it is mirrored to the opposite azimuth at the same height -
    // where it would have got to had it been allowed to continue - and cam.up is negated, so
    // the pole it now approaches is the one it just came over. Dragging carries on down the
    // far side with no stop.
    //
    // Negating up is what it costs: the view rolls 180 degrees at the instant of crossing.
    // That is inherent to a fixed up-vector rather than a shortcoming of this code - a
    // turntable cannot be both the right way up and continuous across its own axis - and it
    // is the accepted price of not stopping. frame() puts up back to +Z, so any named view
    // or Fit undoes it.
    //
    // Mouse only. A one-finger touch and a two-finger pan both arrive as button 0, so on a
    // touchscreen a pan while parked at the pole would read as a push through it.
    const POLE_EPS = 1e-3;      // "pinned" - makeSafe holds it at 1e-6, well inside this
    let orbiting = false;
    let lastPointerY = 0;
    let pushY = 0;              // vertical drag since the last frame, in screen pixels
    // Modifiers excluded because OrbitControls reads left+ctrl/meta/shift as a PAN, not a
    // rotate: without this, shift-dragging to pan while parked on the pole would flip it.
    const onPoleDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      orbiting = true; lastPointerY = e.clientY; pushY = 0;
    };
    const onPoleMove = (e: PointerEvent) => {
      if (!orbiting) return;
      // The button can come up without a pointerup reaching us - alt-tab, or a context
      // menu stealing the release. Without this the next stray move over the canvas would
      // still count as a push and could flip the model while nobody is dragging.
      if (e.buttons === 0) { orbiting = false; pushY = 0; return; }
      pushY += e.clientY - lastPointerY;
      lastPointerY = e.clientY;
    };
    const onPoleEnd = () => { orbiting = false; pushY = 0; };
    renderer.domElement.addEventListener("pointerdown", onPoleDown);
    renderer.domElement.addEventListener("pointermove", onPoleMove);
    renderer.domElement.addEventListener("pointerup", onPoleEnd);
    renderer.domElement.addEventListener("pointercancel", onPoleEnd);

    // Dragging DOWN drives the polar angle towards zero - OrbitControls' rotateUp subtracts
    // from phi - so a positive push is heading for the top pole and a negative one the bottom.
    const crossPole = () => {
      if (!orbiting || pushY === 0) return;
      const phi = ctrl.getPolarAngle();
      const over = (phi <= POLE_EPS && pushY > 0) || (phi >= Math.PI - POLE_EPS && pushY < 0);
      pushY = 0;
      if (!over) return;
      // Mirror the offset about the up axis: keep the part along up, negate the rest. The
      // camera lands as far past the pole as it was short of it, which is a few thousandths
      // of a radian, so the position moves imperceptibly and only the roll is visible.
      const off = cam.position.clone().sub(ctrl.target);
      const along = cam.up.clone().multiplyScalar(off.dot(cam.up));
      cam.position.copy(ctrl.target).add(off.sub(along).negate().add(along));
      cam.up.negate();
      ctrl.update();
    };

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
      // After update(), so it reads the polar angle that makeSafe has just clamped, and
      // before the render, so a crossing is never shown as a stalled frame at the pole.
      crossPole();
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
        renderer.domElement.removeEventListener("pointerdown", onPoleDown);
        renderer.domElement.removeEventListener("pointermove", onPoleMove);
        renderer.domElement.removeEventListener("pointerup", onPoleEnd);
        renderer.domElement.removeEventListener("pointercancel", onPoleEnd);
        // Dispose the CACHE, not each mesh: geometry is shared, so a per-mesh dispose
        // would free a buffer its siblings are still drawing from.
        geomCache.forEach((g) => g.dispose());
        geomCache.clear();
        materials.forEach((m) => m.dispose());
        renderer.dispose();
      },
      remap: (map, states) => {
        // A restore puts instances back that were suppressed, and their geometry was
        // disposed at that point — there is nothing to reassign. Say so and let the caller
        // rebuild rather than silently drawing a scene that is missing what was restored.
        const present = new Set(drawn.map((e) => e.instanceId));
        for (const id of Object.keys(map)) {
          if (!present.has(id)) return false;
        }

        // Regroup in place: reassign each mesh to its new unit's material, and REMOVE any
        // instance the map no longer contains.
        //
        // That second part is how suppression frees memory. A suppressed piece is simply
        // absent from instance_units, so its meshes come out of the scene and its buffers
        // are released — not hidden. On job 10335, keeping only the steel structure takes
        // the scene from 17,051 drawn instances to 10.
        const fresh = new Map<string, InstanceType<typeof THREE.MeshLambertMaterial>>();
        const kept: typeof drawn = [];
        unitBoxes.clear();

        for (const entry of drawn) {
          const { mesh, instanceId } = entry;
          const unit = map[instanceId];
          if (!unit) {
            root.remove(mesh);
            continue;                       // geometry disposed below, once unreferenced
          }
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
          kept.push(entry);
          const box = new THREE.Box3().setFromObject(mesh);
          const existing = unitBoxes.get(unit);
          if (existing) existing.union(box);
          else unitBoxes.set(unit, box.clone());
        }

        // Geometry is shared per (prototype, body), so a buffer may only be freed once
        // nothing still draws from it — disposing per removed mesh would blank its siblings.
        const stillUsed = new Set<InstanceType<typeof THREE.BufferGeometry>>(
          kept.map((e) => e.mesh.geometry as InstanceType<typeof THREE.BufferGeometry>));
        for (const [key, g] of geomCache) {
          if (!stillUsed.has(g)) { g.dispose(); geomCache.delete(key); }
        }

        // Dispose materials for units that no longer exist, or a long session of depth and
        // scope changes leaks one GPU material per abandoned piece.
        for (const [unit, mat] of materials) {
          if (!fresh.has(unit)) mat.dispose();
        }
        materials.clear();
        for (const [unit, mat] of fresh) materials.set(unit, mat);

        drawn.length = 0;
        drawn.push(...kept);
        setMissing(0);
        setSkipped(0);

        // Re-frame: after suppressing most of a plant the camera would otherwise still be
        // fitted to the extent of things that are no longer there.
        refit();
        scene.current?.recolour(states);
        return true;
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
      reset: () => refit(),
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
    // remap handles regrouping and suppression in place. It returns false only when the map
    // has grown — a restore — because those buffers were disposed and cannot be reassigned.
    const handled = scene.current?.remap(instanceUnits, stateByUnit);
    if (handled === false) build();
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

          {/* A model drawn with pieces missing must never look complete. Out of scope is a
              different statement from could-not-be-drawn: one is a decision, the other a
              failure, and they read in different colours for that reason. */}
          {(missing > 0 || skipped > 0 || outOfScope > 0) && (
            <div className="absolute left-2 top-2 space-y-1">
              {outOfScope > 0 && (
                <div className="rounded bg-slate-700/90 px-2 py-1 text-xs font-medium text-slate-100">
                  {outOfScope.toLocaleString()} part{outOfScope === 1 ? "" : "s"} out of scope — not drawn
                </div>
              )}
              {missing > 0 && (
                <div className="rounded bg-amber-500/90 px-2 py-1 text-xs font-medium text-amber-950">
                  {missing} part{missing === 1 ? "" : "s"} could not be drawn
                </div>
              )}
              {skipped > 0 && (
                <div className="rounded bg-amber-600/90 px-2 py-1 text-xs font-medium text-white">
                  Too large to draw in full — {skipped.toLocaleString()} more part
                  {skipped === 1 ? "" : "s"} not shown
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});
