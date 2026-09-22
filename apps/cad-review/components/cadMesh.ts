import type * as THREE_NS from "three";

type Three = typeof THREE_NS;
export type BodyData = { v: number[]; f: number[] };

/**
 * One CAD body as every viewer here draws it (bd kl1y.10).
 *
 * FLAT, NOT SMOOTH. The viewers used to share vertices between faces and compute smoothed vertex
 * normals, so the lighting was averaged across every sharp edge: each flat face of a beam came
 * out as a gradient following its triangles. Steve, 2026-09-22: "the teselated faces are shaded
 * incorrectly". Un-indexing gives every triangle its own normal, so a planar face is one flat tone.
 *
 * FEATURE EDGES are drawn as thin dark lines where the surface turns by more than EDGE_ANGLE -
 * the flange edges, plate outlines and holes a person reads a steel part by.
 *
 * Two-sided, because tessellation winding is not guaranteed and a face seen from behind must still
 * be lit rather than vanish.
 */
const EDGE_ANGLE = 25;

export function bodyObject(THREE: Three, b: BodyData, colour: number,
                           opts: { edges?: boolean; opacity?: number } = {}) {
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute("position", new THREE.Float32BufferAttribute(b.v, 3));
  indexed.setIndex(b.f);
  const flat = indexed.toNonIndexed();
  flat.computeVertexNormals();
  const ghost = opts.opacity !== undefined && opts.opacity < 1;
  const material = new THREE.MeshLambertMaterial({
    color: colour, side: THREE.DoubleSide,
    transparent: ghost, opacity: opts.opacity ?? 1, depthWrite: !ghost,
    // Pushed back a touch so the edge lines sit on the surface, not inside it.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const mesh = new THREE.Mesh(flat, material);
  const group = new THREE.Group();
  group.add(mesh);
  let edges: THREE_NS.LineSegments | null = null;
  if (opts.edges !== false) {
    edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(indexed, EDGE_ANGLE),
      new THREE.LineBasicMaterial({ color: 0x2b3640, transparent: ghost,
                                    opacity: ghost ? 0.25 : 1 }));
    group.add(edges);
  }
  indexed.dispose();
  return { group, mesh, material, edges };
}
