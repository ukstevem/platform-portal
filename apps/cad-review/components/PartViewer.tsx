"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The part, in 3D.
 *
 * A dims-only review is not a review. MIXED especially has to be SEEN — the whole question
 * a reviewer is answering is "why did the machine call this one thing?", and the answer is
 * visual: thirty separate bodies sitting in the same box. So each solid renders in its own
 * colour, which turns "why is this MIXED" into something you read at a glance instead of
 * inferring from a solid count.
 *
 * Exact dimensions are OVERLAID rather than measured with a ruler widget. The numbers are
 * the machine's own OBB (thin x mid x long) and CSA — the same figures identification used —
 * so what you see is what it decided on, not a second measurement that might disagree.
 */

type Mesh = {
  bodies: { v: number[]; f: number[] }[];
  n_solids: number;
  class: string | null;
  designation: string | null;
  dims: { thin: number; mid: number; long: number; csa: number } | null;
  bbox: { min: number[]; max: number[] } | null;
  triangles: number;
  proxy: boolean;
  proxy_reason?: string | null;
};

// Distinct, and distinguishable side by side. Not a gradient: adjacent bodies in a weldment
// are often near-identical shapes, so similar colours would defeat the point.
const BODY_COLOURS = [
  0x1565c0, 0xe53935, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1,
  0xfdd835, 0x6d4c41, 0xec407a, 0x7cb342, 0x5e35b1, 0xff7043,
];

export function PartViewer({ modelId, fingerprintKey }: {
  modelId: string; fingerprintKey: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ view: (v: string) => void; dispose: () => void } | null>(null);
  const [meta, setMeta] = useState<Mesh | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    if (!fingerprintKey) { setMeta(null); setState("idle"); return; }
    let cancelled = false;
    setState("loading"); setMeta(null); setMsg("");

    (async () => {
      let data: Mesh;
      try {
        const res = await fetch(
          `/cad-review/api/cad/models/${modelId}/prototype/${fingerprintKey}/mesh/`,
          { cache: "no-store" });
        if (!res.ok) throw new Error(`mesh returned ${res.status}`);
        data = await res.json();
      } catch (e) {
        if (!cancelled) { setState("error"); setMsg(String((e as Error).message)); }
        return;
      }
      if (cancelled) return;
      setMeta(data);

      const THREE = await import("three");
      const { OrbitControls } = await import(
        "three/examples/jsm/controls/OrbitControls.js");
      if (cancelled || !host.current) return;

      // Tear down any previous scene before building the next, or switching parts leaks a
      // renderer and a canvas per click.
      api.current?.dispose();
      host.current.innerHTML = "";

      const el = host.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeef1f4);
      // Z-up: CAD models are Z-up and a Y-up camera lays the part on its side.
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
      cam.up.set(0, 0, 1);
      const ctrl = new OrbitControls(cam, renderer.domElement);
      ctrl.enableDamping = true;

      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const dl = new THREE.DirectionalLight(0xffffff, 0.7);
      dl.position.set(1, 1.3, 1.2);
      scene.add(dl);

      const root = new THREE.Group();
      scene.add(root);

      // A null body is a deliberate index placeholder (bodies[N] is solid N), not an error.
      (data.bodies || []).forEach((b, i) => {
        if (!b) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(b.v, 3));
        g.setIndex(b.f);
        g.computeVertexNormals();
        root.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({
          color: BODY_COLOURS[i % BODY_COLOURS.length],
        })));
      });

      const box = new THREE.Box3().setFromObject(root);
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) || 1;
      // Frame on the largest extent, not the diagonal: a 10 m member framed by its diagonal
      // sits too far back to read.
      cam.near = radius / 1000; cam.far = radius * 100;

      function view(v: string) {
        const d = radius * 1.9;
        const p: Record<string, [number, number, number]> = {
          iso: [d * 0.8, -d * 0.8, d * 0.6],
          front: [0, -d, 0], side: [d, 0, 0], top: [0, 0, d],
        };
        const [x, y, z] = p[v] ?? p.iso;
        cam.position.set(centre.x + x, centre.y + y, centre.z + z);
        cam.updateProjectionMatrix();
        ctrl.target.copy(centre); ctrl.update();
      }
      view("iso");

      function size_() {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
      }
      const ro = new ResizeObserver(size_); ro.observe(el); size_();

      let raf = 0;
      (function loop() { raf = requestAnimationFrame(loop); ctrl.update(); renderer.render(scene, cam); })();

      api.current = {
        view,
        dispose: () => {
          cancelAnimationFrame(raf); ro.disconnect(); ctrl.dispose();
          root.traverse((o) => {
            const m = o as unknown as { geometry?: { dispose(): void };
                                        material?: { dispose(): void } };
            m.geometry?.dispose(); m.material?.dispose();
          });
          renderer.dispose();
        },
      };
      setState("ready");
    })();

    return () => { cancelled = true; api.current?.dispose(); api.current = null; };
  }, [modelId, fingerprintKey]);

  if (!fingerprintKey) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
        Pick a part to see it.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative flex-1 overflow-hidden rounded-lg border border-slate-200 bg-[#eef1f4]">
        <div ref={host} className="h-full w-full" />
        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            Building the mesh…
          </div>
        )}
        {state === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-amber-800">
            Could not load the part. {msg}
          </div>
        )}
        {state === "ready" && (
          <div className="absolute right-2 top-2 flex gap-1">
            {["iso", "front", "side", "top"].map((v) => (
              <button key={v}
                onClick={() => api.current?.view(v)}
                className="rounded border border-slate-300 bg-white/90 px-2 py-1 text-xs capitalize text-slate-700 hover:bg-white">
                {v}
              </button>
            ))}
          </div>
        )}
        {/* A hull is not the part — say so rather than letting someone review a lie. */}
        {meta?.proxy && (
          <div className="absolute bottom-2 left-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
            Simplified proxy shown{meta.proxy_reason ? ` — ${meta.proxy_reason}` : ""}
          </div>
        )}
      </div>

      {meta && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Fact k="thin" v={`${meta.dims?.thin ?? "—"} mm`} />
            <Fact k="mid" v={`${meta.dims?.mid ?? "—"} mm`} />
            <Fact k="long" v={`${meta.dims?.long ?? "—"} mm`} />
            <Fact k="CSA" v={`${meta.dims?.csa ?? "—"} cm²`} />
            <Fact k="bodies" v={String(meta.n_solids ?? 1)} />
          </div>
          {(meta.n_solids ?? 1) > 1 && (
            <p className="mt-1.5 text-slate-500">
              {meta.n_solids} separate bodies, each a different colour — that is why this is
              a group rather than one part.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-slate-400">{k}</span>{" "}
      <span className="font-medium tabular-nums text-slate-800">{v}</span>
    </span>
  );
}
