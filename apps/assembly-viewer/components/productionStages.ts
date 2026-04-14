export type ProductionStage =
  | "bought_out"
  | "not_started"
  | "on-order"
  | "stock"
  | "plating"
  | "welding"
  | "fabricated"
  | "paint"
  | "galv"
  | "delivered"
  | "installed";

export interface StageDefinition {
  key: ProductionStage;
  label: string;
  meshColor: number;
  dotClass: string;
}

export const PRODUCTION_STAGES: StageDefinition[] = [
  { key: "bought_out",  label: "Bought Out",  meshColor: 0x78716c, dotClass: "bg-stone-500" },
  { key: "not_started", label: "Not Started", meshColor: 0xbbbbbb, dotClass: "bg-gray-400" },
  { key: "on-order",    label: "On Order",    meshColor: 0xf97316, dotClass: "bg-orange-500" },
  { key: "stock",       label: "Stock",       meshColor: 0x06b6d4, dotClass: "bg-cyan-500" },
  { key: "plating",     label: "Plating",     meshColor: 0xeab308, dotClass: "bg-yellow-500" },
  { key: "welding",     label: "Welding",     meshColor: 0xef4444, dotClass: "bg-red-500" },
  { key: "fabricated",  label: "Fabricated",   meshColor: 0x3b82f6, dotClass: "bg-blue-500" },
  { key: "paint",       label: "Paint",       meshColor: 0x8b5cf6, dotClass: "bg-violet-500" },
  { key: "galv",        label: "Galv",        meshColor: 0x94a3b8, dotClass: "bg-slate-400" },
  { key: "delivered",   label: "Delivered",   meshColor: 0x6366f1, dotClass: "bg-indigo-500" },
  { key: "installed",   label: "Installed",   meshColor: 0x22c55e, dotClass: "bg-green-500" },
];

export const STAGE_MESH_COLORS: Record<ProductionStage, number> = Object.fromEntries(
  PRODUCTION_STAGES.map((s) => [s.key, s.meshColor])
) as Record<ProductionStage, number>;

export const STAGE_LABELS: Record<ProductionStage, string> = Object.fromEntries(
  PRODUCTION_STAGES.map((s) => [s.key, s.label])
) as Record<ProductionStage, string>;

/** Progress order — lower = less progressed */
export const STAGE_ORDER: Record<ProductionStage, number> = Object.fromEntries(
  PRODUCTION_STAGES.map((s, i) => [s.key, i])
) as Record<ProductionStage, number>;
