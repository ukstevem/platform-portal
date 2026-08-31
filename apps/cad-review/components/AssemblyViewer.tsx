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
    ctrl.enableDamping = true;
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
      cam.updateProjectionMatrix(); ctrl.target.copy(centre); ctrl.update();
    };
    view.current("iso");

    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w && h) { renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    };
    const ro = new ResizeObserver(fit); ro.observe(el); fit();
    let raf = 0;
    (function loop() { raf = requestAnimationFrame(loop); ctrl.update(); renderer.render(scene, cam); })();
    dispose.current = () => {
      cancelAnimationFrame(raf); ro.disconnect(); ctrl.dispose();
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
