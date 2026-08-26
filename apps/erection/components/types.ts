/** Shapes the erection API returns. Mirrors app/decide/erection.py and app/api/erection.py. */

export type Mark = {
  mark: string | null;
  class: string | null;
  designation: string | null;
  name: string | null;
  qty: number;
};

export type Unit = {
  /** F1 instance-path prefix — the lift is everything beneath it. */
  unit_path: string;
  name: string;
  part_count: number;
  excluded_parts: number;
  mass_kg: number;
  /** False when a part's mass could not be derived; the weight shown is then a floor. */
  mass_complete: boolean;
  mass_unknown_parts: number;
  prototype_keys: string[];
  assemblies: { assembly_key: string; name: string }[];
  marks: Mark[];
  splittable: boolean;
  /**
   * What Open gives you: "assemblies" steps down one tree level and the parts of each
   * sub-assembly stay together; "solids" means the piece has no sub-structure left and
   * comes apart completely — plates separated from the beams they belong to.
   */
  opens_to?: "assemblies" | "solids" | null;
  centroid: [number, number, number];
  origin_extent: [[number, number, number], [number, number, number]];
};

export type StepItem = { unit_path: string };

/**
 * The erection unit's default depth — the root assembly's direct children. Mirrors
 * DEFAULT_DEPTH in app/decide/erection.py. A piece at this depth cannot go wider: one
 * level above is the model root, i.e. the whole job as a single lift.
 */
export const DEFAULT_DEPTH = 2;

export type Step = {
  id: string;
  seq: number;
  title: string | null;
  operation: string | null;
  zone: string | null;
  notes: string | null;
  plant: string | null;
  crew: string | null;
  duration_hours: number | null;
  hold_point: boolean;
  items: StepItem[];
};

export type Plan = {
  id: string;
  model_id: string;
  name: string | null;
  status: string;
  revision: string | null;
  split_paths: string[];
  steps: Step[];
};

/**
 * The operations a step can be. Erection is not only lifting: a piece is landed, then
 * plumbed and bolted, and temporary works come out later — steps that carry no steel but
 * absolutely carry time and a hold point.
 */
export const OPERATIONS = [
  "erect",
  "bolt-up",
  "weld",
  "plumb-align",
  "grout",
  "temp-works",
  "remove-temp",
  "inspect",
] as const;

/**
 * Which pieces are welded to each other — the fact the model tree cannot carry.
 *
 * A lift is a place in the model tree, and that holds only while the tree agrees with what is
 * physically joined. Detected from geometry (world-space weld graph), so it is best-effort and
 * ADVISORY: it is shown beside the palette and never re-shapes it. `detected: false` means
 * detection has not been run — which is not the same as "nothing is welded".
 */
export type WeldGroup = {
  name: string;
  member_count: number;
  mass_kg: number;
  mass_complete: boolean;
  weld_length_mm: number;
  unit_paths: string[];
  spans_units: boolean;
  /** Bought-out or existing plant: delivered assembled, and never welded to our steel. */
  not_fabricated: boolean;
};

export type WeldConflict = {
  group_no: number;
  name: string;
  unit_paths: string[];
  member_count: number;
  mass_kg: number;
  note: string;
};

export type WeldView = {
  detected: boolean;
  /** Welded pieces that straddle two or more lifts — those lifts cannot go up separately. */
  conflicts: WeldConflict[];
  /** unit_path → the welded pieces its parts belong to. */
  unit_groups: Record<string, number[]>;
  /** The inverse error: a "lift" whose parts sit in several welded assemblies. */
  split_units: Record<string, number[]>;
  groups: Record<string, WeldGroup>;
};
