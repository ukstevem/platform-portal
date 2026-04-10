"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@platform/supabase/client";
import { useAuth } from "@platform/auth/AuthProvider";
import type { ProductionStage } from "./productionStages";

export interface StageInfo {
  stage: ProductionStage;
  updatedAt: string;
}

export function useNodeStages(runId: string | null) {
  const { user } = useAuth();
  const [stages, setStages] = useState<Map<string, StageInfo>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);

    supabase
      .from("stl_node_stage")
      .select("node_id, stage, updated_at")
      .eq("run_id", runId)
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to load stages:", error);
        } else if (data) {
          const map = new Map<string, StageInfo>();
          for (const row of data) {
            map.set(row.node_id, {
              stage: row.stage as ProductionStage,
              updatedAt: row.updated_at,
            });
          }
          setStages(map);
        }
        setLoading(false);
      });
  }, [runId]);

  const setStage = useCallback(
    async (nodeId: string, stage: ProductionStage) => {
      if (!runId) return;
      const now = new Date().toISOString();

      setStages((prev) => {
        const next = new Map(prev);
        next.set(nodeId, { stage, updatedAt: now });
        return next;
      });

      const { error } = await supabase
        .from("stl_node_stage")
        .upsert(
          {
            run_id: runId,
            node_id: nodeId,
            stage,
            updated_by: user?.id ?? null,
            updated_at: now,
          },
          { onConflict: "run_id,node_id" }
        );

      if (error) {
        console.error("Failed to save stage:", error);
        setStages((prev) => {
          const next = new Map(prev);
          next.delete(nodeId);
          return next;
        });
      }
    },
    [runId, user]
  );

  const setStageBulk = useCallback(
    async (nodeIds: string[], stage: ProductionStage) => {
      if (!runId || nodeIds.length === 0) return;
      const unique = [...new Set(nodeIds)];
      const now = new Date().toISOString();

      setStages((prev) => {
        const next = new Map(prev);
        for (const nid of unique) next.set(nid, { stage, updatedAt: now });
        return next;
      });

      const rows = unique.map((node_id) => ({
        run_id: runId,
        node_id,
        stage,
        updated_by: user?.id ?? null,
        updated_at: now,
      }));

      const { error } = await supabase
        .from("stl_node_stage")
        .upsert(rows, { onConflict: "run_id,node_id" });

      if (error) {
        console.error("Failed to bulk save stages:", error.message, error.code, error.details);
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
