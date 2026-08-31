"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draw everything under one instance path, each prototype a distinct colour.
 *
 * Shared by the scope list and the assembly walker so both answer the same question the
 * same way: "is this the handrail standard?" is about shape, not about a list of member
 * names, and colouring per prototype is what makes a group legible as a group.
 */

type Inst = { instance_id: string; prototype_key: string; world_placement: number[] | null };

const COLOURS = [
  0x1565c0, 0xe53935, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1,
  0xfdd835, 0x6d4c41, 0xec407a, 0x7cb342, 0x5e35b1, 0xff7043,
];

export function AssemblyViewer({ modelId, prefix, className }: {
  modelId: string; prefix: string | null; className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const dispose = useRef<(() => void) | null>(null);
  const view = useRef<((v: string) => void) | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [info, setInfo] = useState<{ shapes: number; placed: number; capped: boolean } | null>(null);

  const draw = useCallback(async (p: string) => {
    setState("loading"); setInfo(null);
    let instances: Inst[] = []; let capped = false;
    try {
      const res = await fetch(
        `/cad-review/api/cad/models/${modelId}/subtree/?prefix=${encodeURIComponent(p)}`,
        { cache: "no-store" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      instances = d.instances ?? []; capped = !!d.capped;
    } catch { setState("error"); return; }

    const THREE = await import("three");
    const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
    if (!host.current) return;
    dispose.current?.();
    host.current.innerHTML = "";

    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f4);
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
    cam.up.set(0, 0, 1);                       // CAD is Z-up
    const ctrl = new OrbitControls(cam, renderer.domElement);
    // No vertical stop: the default [0, PI] polar clamp jams the orbit at straight-down and
    // straight-up, so an assembly cannot be carried over the top to be read from underneath —
    // which is how you check what a bracket actually sits on. It still stops an epsilon short
    // of each pole, because OrbitControls calls Spherical.makeSafe() after this clamp and pins
    // it there whatever is set; the fixed +Z up vector would flip the view on a true crossing.
    ctrl.minPolarAngle = -Infinity;
    ctrl.maxPolarAngle = Infinity;
    // Damping off: it left the assembly turning after the button came up, so a nudge to look
    // at one end overshot and had to be brought back. Motion now ends with the drag, and the
    // RAF loop's ctrl.update() stays — it is what applies zoom and pan, damping or not.
    ctrl.enableDamping = false;
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7);
    dl.position.set(1, 1.3, 1.2); scene.add(dl);
    const root = new THREE.Group(); scene.add(root);

    // One mesh fetch per distinct prototype: a handrail run is four shapes placed sixty
    // times, so fetching per instance would be fifteen times the work for the same picture.
    const keys = Array.from(new Set(instances.map((i) => i.prototype_key)));
    const geo = new Map<string, { v: number[]; f: number[] }[]>();
    for (const k of keys) {
      try {
        const m = await fetch(`/cad-review/api/cad/models/${modelId}/prototype/${k}/mesh/`,
                              { cache: "no-store" });
        if (m.ok) geo.set(k, (await m.json()).bodies ?? []);
      } catch { /* one unmeshable body must not lose the whole view */ }
    }

    let placed = 0;
    instances.forEach((inst) => {
      const bodies = geo.get(inst.prototype_key);
      if (!bodies?.length) return;
      const colour = COLOURS[keys.indexOf(inst.prototype_key) % COLOURS.length];
      bodies.forEach((b) => {
        if (!b) return;   // index placeholder — bodies[N] is solid N
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(b.v, 3));
        g.setIndex(b.f); g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: colour }));
        if (inst.world_placement)
          mesh.applyMatrix4(new THREE.Matrix4().fromArray(inst.world_placement));
        root.add(mesh); placed++;
      });
    });

    const box = new THREE.Box3().setFromObject(root);
    const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) || 1;
    cam.near = radius / 1000; cam.far = radius * 100;
    view.current = (v: string) => {
      const d = radius * 1.9;
      const pos: Record<string, [number, number, number]> = {
        iso: [d * 0.8, -d * 0.8, d * 0.6], front: [0, -d, 0], side: [d, 0, 0], top: [0, 0, d],
      };
      const [x, y, z] = pos[v] ?? pos.iso;
      cam.position.set(centre.x + x, centre.y + y, centre.z + z);
      // Up back to +Z: orbiting over a pole negates it (see crossPole below), and a named
      // view taken while it is inverted comes out rolled 180 degrees. These four buttons are
      // therefore also the way back to level. Top stays degenerate - [0, 0, d] is on the +Z
      // axis with up along it - and still survives on makeSafe() nudging the polar angle
      // 1e-6 off the pole inside update(), exactly as it did before.
      cam.up.set(0, 0, 1);
      cam.updateProjectionMatrix(); ctrl.target.copy(centre); ctrl.update();
    };
    view.current("iso");

    // Orbiting over the poles. OrbitControls stops dead at straight-up and straight-down
    // because update() ends with Spherical.makeSafe(), which pins the polar angle within
    // 1e-6 rad of each pole whatever the min/max are set to. So when a drag has the camera
    // pinned and is still pushing in, mirror it to the opposite azimuth at the same height
    // and negate cam.up: the orbit carries on down the far side instead of stopping. The
    // cost is a 180 degree roll at the instant of crossing, which is inherent to holding a
    // fixed up-vector, not a defect here - the four view buttons above reset it. Mouse only,
    // since a two-finger touch pan also arrives as button 0 and would read as a push.
    const POLE_EPS = 1e-3;
    let orbiting = false, lastPointerY = 0, pushY = 0;
    // Modifiers excluded: OrbitControls treats left+ctrl/meta/shift as a pan, not a rotate.
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
      pushY += e.clientY - lastPointerY; lastPointerY = e.clientY;
    };
    const onPoleEnd = () => { orbiting = false; pushY = 0; };
    renderer.domElement.addEventListener("pointerdown", onPoleDown);
    renderer.domElement.addEventListener("pointermove", onPoleMove);
    renderer.domElement.addEventListener("pointerup", onPoleEnd);
    renderer.domElement.addEventListener("pointercancel", onPoleEnd);
    // Dragging down drives the polar angle towards zero, so a positive push heads for the
    // top pole and a negative one for the bottom.
    const crossPole = () => {
      if (!orbiting || pushY === 0) return;
      const phi = ctrl.getPolarAngle();
      const over = (phi <= POLE_EPS && pushY > 0) || (phi >= Math.PI - POLE_EPS && pushY < 0);
      pushY = 0;
      if (!over) return;
      // Keep the component along up, negate the rest: the camera lands as far past the pole
      // as it was short of it, a few thousandths of a radian, so only the roll is visible.
      const off = cam.position.clone().sub(ctrl.target);
      const along = cam.up.clone().multiplyScalar(off.dot(cam.up));
      cam.position.copy(ctrl.target).add(off.sub(along).negate().add(along));
      cam.up.negate();
      ctrl.update();
    };

    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w && h) { renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    };
    const ro = new ResizeObserver(fit); ro.observe(el); fit();
    let raf = 0;
    // crossPole after update() so it sees the polar angle makeSafe has just clamped, and
    // before the render so a crossing never shows as a stalled frame at the pole.
    (function loop() {
      raf = requestAnimationFrame(loop); ctrl.update(); crossPole(); renderer.render(scene, cam);
    })();
    dispose.current = () => {
      cancelAnimationFrame(raf); ro.disconnect(); ctrl.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPoleDown);
      renderer.domElement.removeEventListener("pointermove", onPoleMove);
      renderer.domElement.removeEventListener("pointerup", onPoleEnd);
      renderer.domElement.removeEventListener("pointercancel", onPoleEnd);
      root.traverse((o) => {
        const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        m.geometry?.dispose(); m.material?.dispose();
      });
      renderer.dispose();
    };
    setInfo({ shapes: keys.length, placed, capped });
    setState("ready");
  }, [modelId]);

  useEffect(() => {
    if (!prefix) { dispose.current?.(); setState("idle"); return; }
    draw(prefix);
    return () => { dispose.current?.(); dispose.current = null; };
  }, [prefix, draw]);

  if (!prefix) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400 ${className ?? ""}`}>
        Pick one to see it.
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-200 bg-[#eef1f4] ${className ?? ""}`}>
      <div ref={host} className="h-full w-full" />
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          Building…
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-amber-800">
          Could not load this assembly.
        </div>
      )}
      {state === "ready" && (
        <>
          <div className="absolute right-2 top-2 flex gap-1">
            {["iso", "front", "side", "top"].map((v) => (
              <button key={v} onClick={() => view.current?.(v)}
                className="rounded border border-slate-300 bg-white/90 px-2 py-1 text-xs capitalize text-slate-700 hover:bg-white">
                {v}
              </button>
            ))}
          </div>
          <div className="absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-xs text-slate-600">
            {info?.shapes} shape{info?.shapes === 1 ? "" : "s"} · {info?.placed} placed
            {/* Never let a truncated assembly look complete — that is how someone
                confirms the wrong thing as bought. */}
            {info?.capped && <span className="ml-1 text-amber-700">· truncated</span>}
          </div>
        </>
      )}
    </div>
  );
}
