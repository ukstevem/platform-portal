"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@platform/supabase/client";
import { useAuth } from "@platform/auth/AuthProvider";
import type { ProductionStage } from "./productionStages";

/** The timestamp columns in stl_node_stage */
const STAGE_COLUMNS: Record<ProductionStage, string> = {
  bought_out: "bought_out_at",
  not_started: "not_started_at",
  "on-order": "on_order_at",
  stock: "stock_at",
  plating: "plating_at",
  welding: "welding_at",
  fabricated: "fabricated_at",
  paint: "paint_at",
  galv: "galv_at",
  delivered: "delivered_at",
  installed: "installed_at",
};

export interface StageInfo {
  /** The current (latest) stage */
  stage: ProductionStage;
  /** When the current stage was set */
  updatedAt: string;
  /** All stage timestamps for provenance */
  timestamps: Partial<Record<ProductionStage, string>>;
}

/** Derive the current stage from a row by finding the latest non-null timestamp */
function deriveCurrentStage(row: Record<string, unknown>): StageInfo | null {
  let latestStage: ProductionStage | null = null;
  let latestDate: string | null = null;
  const timestamps: Partial<Record<ProductionStage, string>> = {};

  for (const [stage, col] of Object.entries(STAGE_COLUMNS)) {
    const val = row[col] as string | null;
    if (val) {
      timestamps[stage as ProductionStage] = val;
      if (!latestDate || val > latestDate) {
        latestDate = val;
        latestStage = stage as ProductionStage;
      }
    }
  }

  if (!latestStage || !latestDate) return null;
  return { stage: latestStage, updatedAt: latestDate, timestamps };
}

export function useNodeStages(runId: string | null) {
  const { user } = useAuth();
  const [stages, setStages] = useState<Map<string, StageInfo>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);

    async function fetchAll() {
      const map = new Map<string, StageInfo>();
      const PAGE_SIZE = 1000;
      let offset = 0;
      let done = false;

      while (!done) {
        const { data, error } = await supabase
          .from("stl_node_stage")
          .select("*")
          .eq("run_id", runId)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error("Failed to load stages:", error);
          break;
        }

        if (data) {
          for (const row of data) {
            const info = deriveCurrentStage(row);
            if (info) {
              map.set(row.node_id as string, info);
            }
          }
        }

        if (!data || data.length < PAGE_SIZE) {
          done = true;
        } else {
          offset += PAGE_SIZE;
        }
      }

      setStages(map);
      setLoading(false);
      console.log(`[useNodeStages] loaded ${map.size} stages for run ${runId}`);
    }

    fetchAll();
  }, [runId]);

  const setStage = useCallback(
    async (nodeId: string, stage: ProductionStage) => {
      if (!runId) return;
      const now = new Date().toISOString();
      const col = STAGE_COLUMNS[stage];

      // Optimistic update
      setStages((prev) => {
        const next = new Map(prev);
        const existing = prev.get(nodeId);
        const timestamps = { ...existing?.timestamps, [stage]: now };
        next.set(nodeId, { stage, updatedAt: now, timestamps });
        return next;
      });

      const { error } = await supabase
        .from("stl_node_stage")
        .upsert(
          {
            run_id: runId,
            node_id: nodeId,
            [col]: now,
            updated_by: user?.id ?? null,
          },
          { onConflict: "run_id,node_id" }
        );

      if (error) {
        console.error("Failed to save stage:", error);
      }
    },
    [runId, user]
  );

  const setStageBulk = useCallback(
    async (nodeIds: string[], stage: ProductionStage) => {
      if (!runId || nodeIds.length === 0) return;
      const unique = [...new Set(nodeIds)];
      const now = new Date().toISOString();
      const col = STAGE_COLUMNS[stage];

      // Optimistic update
      setStages((prev) => {
        const next = new Map(prev);
        for (const nid of unique) {
          const existing = prev.get(nid);
          const timestamps = { ...existing?.timestamps, [stage]: now };
          next.set(nid, { stage, updatedAt: now, timestamps });
        }
        return next;
      });

      const rows = unique.map((node_id) => ({
        run_id: runId,
        node_id,
        [col]: now,
        updated_by: user?.id ?? null,
      }));

      // Supabase upsert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase
          .from("stl_node_stage")
          .upsert(batch, { onConflict: "run_id,node_id" });

        if (error) {
          console.error("Failed to bulk save stages:", error);
        }
      }
    },
    [runId, user]
  );

  const clearStage = useCallback(
    async (nodeId: string) => {
      if (!runId) return;

      setStages((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });

      const { error } = await supabase
        .from("stl_node_stage")
        .delete()
        .eq("run_id", runId)
        .eq("node_id", nodeId);

      if (error) {
        console.error("Failed to clear stage:", error);
      }
    },
    [runId]
  );

  return { stages, setStage, setStageBulk, clearStage, loading };
}
