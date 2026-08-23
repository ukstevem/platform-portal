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
