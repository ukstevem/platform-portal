"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { bodyObject } from "./cadMesh";

/**
 * A piece in 3D, edited by pointing at it (bd kl1y.10).
 *
 * Steve, 2026-09-22: "i cant identify what is what from the tables. this needs to be done in the
 * model view, so i can select parts and remove/add from/to group. maybe highlight or provide the
 * weld i can hover on the table and highlights in the view and i can erase, which would split the
 * part potentially."
 *
 * Every edit is a decision about ONE joint - cut (it does not hold the piece together) or link
 * (these two parts are one piece) - so "split these parts off" is the cuts around them and "add
 * that part" is a link to it. The effect is worked out here, in the browser, as you go: parts
 * are recoloured by the piece they would end up in, and nothing is stored until Save.
 */

type Part = {
  id: string; in_piece: boolean; name: string; kind: string; mark: string | null;
  class: string | null; designation: string | null; mass_kg: number; supply: string | null;
  box: number[] | null; mesh: { v: number[]; f: number[] } | null;
};
type Joint = {
  id: string; a: string; b: string; kind: string; weld_mm: number; bolts: number;
  method: string | null; joins: boolean; why: string; override: "cut" | "link" | null;
  joins_rule: boolean; at: number[] | null;
};
type Scene = {
  prefix: string; piece: { key: string; label: string; qty: number; parts: number };
  parts: Part[]; joints: Joint[]; neighbours_capped: boolean;
};
type Edit = "cut" | "link" | "clear";

const MAIN = 0x8fa9bf;
const SPLIT = [0xe0a458, 0x7fb069, 0xc97c9d, 0x6fb7c9, 0xd9c35c, 0x9a8ad9, 0xb58b6b];
const GHOST = 0xc7ced4;
const SELECTED = 0xff8c1a;
const JOINT_PART = 0xffd84d;
const MARK = { held: 0xe07b1a, erased: 0xd13b3b, bolt: 0x2f6fd6, contact: 0x8a96a3,
               link: 0x2e9e5b } as const;

function holds(j: Joint, e?: Edit): boolean {
  if (e === "cut") return false;
  if (e === "link") return true;
  if (e === "clear") return j.joins_rule;
  return j.joins;
}

export function PieceEditor({ modelId, prefix, piece, onSaved }: {
  modelId: string; prefix: string; piece: string; onSaved: (piece: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const three = useRef<{
    parts: Map<string, { material: THREE_NS.MeshLambertMaterial; edges: THREE_NS.LineSegments | null;
                         group: THREE_NS.Object3D }>;
    markers: Map<string, THREE_NS.Mesh>;
  } | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [hoverJoint, setHoverJoint] = useState<string | null>(null);
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  const [show, setShow] = useState({ welds: true, bolts: true, contacts: false, neighbours: true });
  const [saving, setSaving] = useState(false);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  const api = `/cad-review/api/cad/models/${modelId}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${api}/isolate/piece-scene/?prefix=${encodeURIComponent(prefix)}`
                                + `&piece=${piece}`, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) { setErr(res.status === 404 ? "gone" : `scene returned ${res.status}`); return; }
        const body: Scene = await res.json();
        if (live) setScene(body);
      } catch { if (live) setErr("Could not reach the CAD service"); }
    })();
    return () => { live = false; };
  }, [api, prefix, piece]);

  const byId = useMemo(() => new Map((scene?.parts ?? []).map((p) => [p.id, p])), [scene]);

  // Which piece every part would be in, given the edits so far.
  const layout = useMemo(() => {
    if (!scene) return null;
    const parent = new Map<string, string>(scene.parts.map((p) => [p.id, p.id]));
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; }
      return r;
    };
    for (const j of scene.joints) {
      if (!parent.has(j.a) || !parent.has(j.b)) continue;
      if (holds(j, edits.get(j.id))) {
        const ra = find(j.a), rb = find(j.b);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
    const groups = new Map<string, string[]>();
    for (const p of scene.parts) {
      const r = find(p.id);
      groups.set(r, [...(groups.get(r) ?? []), p.id]);
    }
    const originals = (ids: string[]) => ids.filter((i) => byId.get(i)?.in_piece).length;
    const withPiece = [...groups.entries()].filter(([, ids]) => originals(ids) > 0)
      .sort((x, y) => originals(y[1]) - originals(x[1]));
    const colourOf = new Map<string, number>();
    withPiece.forEach(([, ids], i) => ids.forEach((id) =>
      colourOf.set(id, i === 0 ? MAIN : SPLIT[(i - 1) % SPLIT.length])));
    const mainIds = new Set(withPiece[0]?.[1] ?? []);
    const anchor = (withPiece[0]?.[1] ?? []).find((i) => byId.get(i)?.in_piece) ?? null;
    return { colourOf, becomes: withPiece.length, mainIds, anchor,
             mainParts: withPiece[0]?.[1].length ?? 0 };
  }, [scene, edits, byId]);

  // Build the 3D scene once per piece.
  useEffect(() => {
    if (!scene || !box.current) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { TrackballControls } = await import("three/examples/jsm/controls/TrackballControls.js");
      if (disposed || !box.current) return;
      const el = box.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.setClearColor(0xf8fafc);
      el.appendChild(renderer.domElement);
      const s3 = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 1, 1e7);
      cam.up.set(0, 0, 1);
      s3.add(cam);
      // three 0.155+ light units are physical: Lambert divides by pi, so an ambient of 0.62
      // came out near 0.2 and the steel read as near black. Scaled by pi to what was meant.
      s3.add(new THREE.AmbientLight(0xffffff, 0.6 * Math.PI));
      // A headlight: lit from just above the eye, along the view. Its TARGET must ride with the
      // camera too - left at the world origin (the default) it shone from the model towards
      // 0,0,0, kilometres away, and lit the backs of everything: the steel came out near black.
      const head = new THREE.DirectionalLight(0xffffff, 0.8 * Math.PI);
      head.position.set(0.3, 0.6, 0);
      head.target.position.set(0, 0, -1);
      cam.add(head);
      cam.add(head.target);

      const parts = new Map<string, { material: THREE_NS.MeshLambertMaterial;
                                      edges: THREE_NS.LineSegments | null;
                                      group: THREE_NS.Object3D }>();
      const pickables: THREE_NS.Object3D[] = [];
      const bounds = new THREE.Box3();
      for (const p of scene.parts) {
        let obj: { group: THREE_NS.Object3D; mesh: THREE_NS.Mesh;
                   material: THREE_NS.MeshLambertMaterial; edges: THREE_NS.LineSegments | null };
        if (p.mesh) {
          obj = bodyObject(THREE, p.mesh, MAIN, { opacity: p.in_piece ? 1 : 0.22 });
        } else if (p.box) {
          // Not prepared: the part's box, so it can still be seen and picked.
          const [x0, y0, z0, x1, y1, z1] = p.box;
          const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
          g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
          const material = new THREE.MeshLambertMaterial({ color: MAIN, transparent: true,
                                                           opacity: 0.5 });
          const mesh = new THREE.Mesh(g, material);
          obj = { group: mesh, mesh, material, edges: null };
        } else continue;
        obj.mesh.userData.partId = p.id;
        s3.add(obj.group);
        parts.set(p.id, { material: obj.material, edges: obj.edges, group: obj.group });
        pickables.push(obj.mesh);
        if (p.in_piece) bounds.expandByObject(obj.group);
      }
      const size = bounds.getSize(new THREE.Vector3());
      const centre = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) || 1000;

      const markers = new Map<string, THREE_NS.Mesh>();
      const dot = new THREE.SphereGeometry(Math.max(radius * 0.0045, 6), 12, 8);
      for (const j of scene.joints) {
        if (!j.at) continue;
        const m = new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: MARK.held,
                                                                     depthTest: false }));
        m.renderOrder = 10;                      // markers stay visible through the steel
        m.position.set(j.at[0], j.at[1], j.at[2]);
        m.userData.jointId = j.id;
        s3.add(m);
        markers.set(j.id, m);
      }
      three.current = { parts, markers };

      const d = radius * 1.6;
      cam.position.set(centre.x + d * 0.8, centre.y - d * 0.9, centre.z + d * 0.6);
      cam.lookAt(centre);
      const ctrl = new TrackballControls(cam, renderer.domElement);
      ctrl.target.copy(centre);
      ctrl.rotateSpeed = 3.0; ctrl.zoomSpeed = 1.4; ctrl.panSpeed = 0.9;
      ctrl.staticMoving = true;

      // Picking: markers first (they sit on top), then parts. Click = press and release without
      // dragging; a drag is the camera's.
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const pick = (e: PointerEvent) => {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, cam);
        const mk = ray.intersectObjects([...markers.values()].filter((m) => m.visible), false)[0];
        if (mk) return { joint: mk.object.userData.jointId as string, part: null };
        const hit = ray.intersectObjects(pickables.filter((o) => o.parent?.visible !== false
                                                          && o.visible), false)[0];
        return { joint: null, part: (hit?.object.userData.partId as string) ?? null };
      };
      let down: { x: number; y: number } | null = null;
      let raf = 0;
      const onMove = (e: PointerEvent) => {
        if (down || raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const got = pick(e);
          setHoverJoint(got.joint); setHoverPart(got.part);
        });
      };
      const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
      const onUp = (e: PointerEvent) => {
        const was = down; down = null;
        if (!was || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 4) return;
        const got = pick(e);
        if (got.joint) {
          setHoverJoint(got.joint);
          rowRefs.current.get(got.joint)?.scrollIntoView({ block: "nearest" });
          return;
        }
        setSel((prev) => {
          if (!got.part) return e.shiftKey ? prev : new Set();
          const next = new Set(e.shiftKey || e.ctrlKey ? prev : []);
          if (next.has(got.part)) next.delete(got.part); else next.add(got.part);
          return next;
        });
      };
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);

      const ro = new ResizeObserver(() => {
        renderer.setSize(el.clientWidth, el.clientHeight);
        cam.aspect = el.clientWidth / el.clientHeight; cam.updateProjectionMatrix();
        ctrl.handleResize();
      });
      ro.observe(el);
      let alive = true;
      const loop = () => { if (!alive) return; ctrl.update(); renderer.render(s3, cam);
                           requestAnimationFrame(loop); };
      loop();
      cleanup = () => {
        alive = false; ro.disconnect(); ctrl.dispose();
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointerup", onUp);
        s3.traverse((o) => {
          const m = o as THREE_NS.Mesh;
          m.geometry?.dispose?.();
          const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
          (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
        });
        renderer.dispose(); el.removeChild(renderer.domElement);
        three.current = null;
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, [scene]);

  // Colours, highlights and visibility follow the edits, selection, hover and filters.
  useEffect(() => {
    const t = three.current;
    if (!t || !scene || !layout) return;
    const hj = hoverJoint ? scene.joints.find((j) => j.id === hoverJoint) : null;
    for (const p of scene.parts) {
      const o = t.parts.get(p.id);
      if (!o) continue;
      const inAPiece = layout.colourOf.has(p.id);
      o.group.visible = inAPiece || show.neighbours;
      const ofJoint = !!hj && (hj.a === p.id || hj.b === p.id);
      const lit = sel.has(p.id) || p.id === hoverPart || ofJoint;
      // The two parts of the joint being hovered turn yellow: among 400 parts an emissive tint
      // alone does not find them.
      o.material.color.setHex(ofJoint ? JOINT_PART : sel.has(p.id) ? SELECTED
                              : (layout.colourOf.get(p.id) ?? GHOST));
      o.material.emissive.setHex(lit ? 0x3a3a3a : 0x000000);
      const ghost = !inAPiece && !ofJoint;
      o.material.transparent = ghost; o.material.opacity = ghost ? 0.22 : 1;
      o.material.depthWrite = !ghost;
    }
    for (const j of scene.joints) {
      const m = t.markers.get(j.id);
      if (!m) continue;
      const e = edits.get(j.id);
      const h = holds(j, e);
      const kindOn = j.kind === "weld" ? show.welds : j.kind === "bolt" ? show.bolts
        : j.kind === "link" ? true : show.contacts;
      const touchesSel = sel.size === 0 || sel.has(j.a) || sel.has(j.b);
      // While a joint is hovered it is the ONLY marker shown: one dot among 500 is not findable.
      m.visible = hoverJoint ? j.id === hoverJoint : kindOn && touchesSel;
      const col = (e === "link" || (h && j.kind !== "weld")) ? MARK.link
        : j.kind === "weld" ? (h ? MARK.held : MARK.erased)
        : j.kind === "bolt" ? MARK.bolt : MARK.contact;
      (m.material as THREE_NS.MeshBasicMaterial).color.setHex(col);
      m.scale.setScalar(j.id === hoverJoint ? 2.4 : 1);
    }
  }, [scene, layout, edits, sel, hoverJoint, hoverPart, show]);

  function setEdit(j: Joint, e: Edit | null) {
    setEdits((prev) => {
      const next = new Map(prev);
      if (e === null) next.delete(j.id); else next.set(j.id, e);
      return next;
    });
  }

  function erase(j: Joint) { setEdit(j, "cut"); }
  function restore(j: Joint) {
    // Undo a pending edit; or, for one saved earlier, hand the joint back to the rules.
    if (edits.has(j.id)) setEdit(j, null); else setEdit(j, "clear");
  }

  function splitSelected() {
    if (!scene) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const j of scene.joints) {
        if (sel.has(j.a) !== sel.has(j.b) && holds(j, next.get(j.id))) next.set(j.id, "cut");
      }
      return next;
    });
  }

  function addSelected() {
    if (!scene || !layout) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const id of sel) {
        if (layout.mainIds.has(id)) continue;
        const j = scene.joints.find((x) => (x.a === id && layout.mainIds.has(x.b))
                                           || (x.b === id && layout.mainIds.has(x.a)));
        if (j) next.set(j.id, "link");
      }
      return next;
    });
  }

  async function save() {
    if (!scene || !edits.size) return;
    setSaving(true); setErr(null);
    try {
      const list = scene.joints.filter((j) => edits.has(j.id))
        .map((j) => ({ a: j.a, b: j.b, action: edits.get(j.id) }));
      const res = await fetch(`${api}/isolate/edits/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, anchor: layout?.anchor, edits: list }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.detail ?? `saving returned ${res.status}`); return; }
      onSaved(body.piece ?? null);
    } catch { setErr("Could not reach the CAD service"); }
    finally { setSaving(false); }
  }

  if (err === "gone") {
    return <p className="text-sm text-amber-800">This piece has changed since it was opened.</p>;
  }
  if (err && !scene) return <p className="text-sm text-amber-800">{err}</p>;

  const label = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.name}${p.mark ? ` (${p.mark})` : ""}` : id;
  };
  const listed = (scene?.joints ?? []).filter((j) =>
    (sel.size ? sel.has(j.a) || sel.has(j.b) : true)
    && (j.kind === "weld" ? show.welds : j.kind === "bolt" ? show.bolts
        : j.kind === "link" ? true : show.contacts))
    .sort((x, y) => (x.kind === y.kind ? y.weld_mm - x.weld_mm : x.kind.localeCompare(y.kind)
      * (x.kind === "weld" ? -1 : 1)));
  const selParts = [...sel].map((id) => byId.get(id)).filter(Boolean) as Part[];
  const selInPiece = selParts.filter((p) => layout?.mainIds.has(p.id));
  const selOutside = selParts.filter((p) => !layout?.mainIds.has(p.id));
  const hp = hoverPart ? byId.get(hoverPart) : null;

  return (
    <div className="space-y-2">
      {edits.size > 0 && layout && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-slate-900
                        bg-white px-4 py-2 text-sm">
          <span>
            <strong>{edits.size}</strong> change{edits.size === 1 ? "" : "s"} — this piece would
            become <strong>{layout.becomes}</strong> piece{layout.becomes === 1 ? "" : "s"}
            {layout.becomes > 1 && " (each split-off shown in its own colour)"}.
          </span>
          <button onClick={save} disabled={saving}
                  className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
            {saving ? "Saving…" : "Save"}</button>
          <button onClick={() => setEdits(new Map())} disabled={saving}
                  className="rounded border border-slate-300 px-3 py-1">Discard</button>
          {err && <span className="text-amber-800">{err}</span>}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="relative">
          <div ref={box} className="h-[72vh] w-full overflow-hidden rounded-lg border border-slate-200" />
          {!scene && <p className="absolute inset-0 flex items-center justify-center text-sm
                                  text-slate-500">Loading the piece…</p>}
          {hp && (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-white/90 px-2 py-1
                            text-xs shadow">
              <strong>{hp.name}</strong>{hp.mark && ` · ${hp.mark}`} · {hp.mass_kg} kg
              {!layout?.colourOf.has(hp.id) && " · not in this piece"}
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Drag to turn, right-drag to pan, wheel to zoom. Click a part to select it and list its
            joints; shift-click for more. Hover a joint in the list to find it in the model.
          </p>
        </div>

        <div className="space-y-2 lg:max-h-[78vh] lg:overflow-y-auto">
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white
                          px-3 py-2 text-xs text-slate-700">
            <Toggle on={show.welds} set={(v) => setShow({ ...show, welds: v })}
                    dot={MARK.held}>welds</Toggle>
            <Toggle on={show.bolts} set={(v) => setShow({ ...show, bolts: v })}
                    dot={MARK.bolt}>bolts</Toggle>
            <Toggle on={show.contacts} set={(v) => setShow({ ...show, contacts: v })}
                    dot={MARK.contact}>touching</Toggle>
            <Toggle on={show.neighbours} set={(v) => setShow({ ...show, neighbours: v })}
                    dot={GHOST}>neighbouring parts</Toggle>
            <span className="flex items-center gap-1"><Dot c={MARK.erased} />erased</span>
            <span className="flex items-center gap-1"><Dot c={MARK.link} />joined by you</span>
          </div>

          {selParts.length > 0 && (
            <div className="space-y-1 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <strong>{selParts.length} selected</strong>
                <button onClick={() => setSel(new Set())} className="text-xs text-slate-500">clear</button>
              </div>
              <div className="max-h-24 overflow-y-auto text-xs text-slate-700">
                {selParts.map((p) => <div key={p.id}>{label(p.id)}</div>)}
              </div>
              <div className="flex flex-wrap gap-2">
                {selInPiece.length > 0 && (
                  <button onClick={splitSelected}
                          className="rounded bg-slate-900 px-2.5 py-1 text-xs text-white">
                    Split {selInPiece.length === 1 ? "it" : "them"} off this piece</button>
                )}
                {selOutside.length > 0 && (
                  <button onClick={addSelected}
                          className="rounded border border-slate-400 px-2.5 py-1 text-xs">
                    Add {selOutside.length === 1 ? "it" : "them"} to this piece</button>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
              {sel.size ? "Joints of the selected parts" : "Joints"} ({listed.length})
            </div>
            <ul className="divide-y divide-slate-100 text-xs">
              {listed.slice(0, 400).map((j) => {
                const e = edits.get(j.id);
                const h = holds(j, e);
                const cut = e === "cut" || (!e && j.override === "cut");
                const linked = e === "link" || (!e && j.override === "link");
                return (
                  <li key={j.id} ref={(el) => { if (el) rowRefs.current.set(j.id, el); }}
                      onMouseEnter={() => setHoverJoint(j.id)} onMouseLeave={() => setHoverJoint(null)}
                      className={`flex items-center gap-2 px-3 py-1.5 ${
                        hoverJoint === j.id ? "bg-amber-50" : ""}`}>
                    <Dot c={linked ? MARK.link : j.kind === "weld" ? (h ? MARK.held : MARK.erased)
                            : j.kind === "bolt" ? MARK.bolt : MARK.contact} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{label(j.a)} ↔ {label(j.b)}</div>
                      <div className="text-slate-500">
                        {j.kind === "weld" ? `weld ${j.weld_mm} mm` : j.kind === "bolt"
                          ? `bolted${j.bolts ? ` ×${j.bolts}` : ""}` : j.kind === "link"
                          ? "joined by you" : "touching"}
                        {" · "}{e ? (h ? "will hold the piece" : "will not hold the piece")
                          : j.why}
                      </div>
                    </div>
                    {j.kind === "weld" && h && !linked && (
                      <button onClick={() => erase(j)}
                              className="rounded border border-red-300 px-2 py-0.5 text-red-700">
                        Erase</button>
                    )}
                    {(cut || linked) && (
                      <button onClick={() => restore(j)}
                              className="rounded border border-slate-300 px-2 py-0.5">Restore</button>
                    )}
                    {j.kind !== "weld" && !h && (
                      <button onClick={() => setEdit(j, "link")}
                              className="rounded border border-green-400 px-2 py-0.5 text-green-800">
                        Join</button>
                    )}
                  </li>
                );
              })}
            </ul>
            {listed.length > 400 && (
              <p className="px-3 py-2 text-xs text-slate-500">
                Showing 400 of {listed.length}. Click a part to list only its joints.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot({ c }: { c: number }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
               style={{ background: `#${c.toString(16).padStart(6, "0")}` }} />;
}

function Toggle({ on, set, dot, children }: {
  on: boolean; set: (v: boolean) => void; dot: number; children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <Dot c={dot} />{children}
    </label>
  );
}
