"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@platform/supabase/client";
import { useAuth } from "@platform/auth/AuthProvider";
import type { ProductionStage } from "./productionStages";

export function useNodeStages(runId: string | null) {
  const { user } = useAuth();
  const [stages, setStages] = useState<Map<string, ProductionStage>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);

    supabase
      .from("stl_node_stage")
      .select("node_id, stage")
      .eq("run_id", runId)
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to load stages:", error);
        } else if (data) {
          const map = new Map<string, ProductionStage>();
          for (const row of data) {
            map.set(row.node_id, row.stage as ProductionStage);
          }
          setStages(map);
        }
        setLoading(false);
      });
  }, [runId]);

  const setStage = useCallback(
    async (nodeId: string, stage: ProductionStage) => {
      if (!runId) return;

      // Optimistic update
      setStages((prev) => {
        const next = new Map(prev);
        next.set(nodeId, stage);
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
            updated_at: new Date().toISOString(),
          },
          { onConflict: "run_id,node_id" }
        );

      if (error) {
        console.error("Failed to save stage:", error);
        // Revert on failure
        setStages((prev) => {
          const next = new Map(prev);
          next.delete(nodeId);
          return next;
        });
      }
    },
    [runId, user]
  );

  const clearStage = useCallback(
    async (nodeId: string) => {
      if (!runId) return;

      // Optimistic removal
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

  return { stages, setStage, clearStage, loading };
}
