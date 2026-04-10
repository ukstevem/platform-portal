"use client";

import { PRODUCTION_STAGES } from "./productionStages";
import type { StageInfo } from "./useNodeStages";
import type { TreeNode } from "./AssemblyTree";

interface StageTableProps {
  /** The nodes currently loaded in the scene */
  sceneNodes: TreeNode[];
  stages: Map<string, StageInfo>;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })
    + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const STAGE_DOT_MAP = Object.fromEntries(
  PRODUCTION_STAGES.map((s) => [s.key, s.dotClass])
);
const STAGE_LABEL_MAP = Object.fromEntries(
  PRODUCTION_STAGES.map((s) => [s.key, s.label])
);

export function StageTable({ sceneNodes, stages }: StageTableProps) {
  if (sceneNodes.length === 0) return null;

  return (
    <div className="border-t border-gray-200 bg-white overflow-auto max-h-64">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Name</th>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Type</th>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Status</th>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Updated</th>
          </tr>
        </thead>
        <tbody>
          {sceneNodes.map((node) => {
            const info = stages.get(node.id);
            return (
              <tr key={node.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-1 text-gray-800 font-medium truncate max-w-[200px]" title={node.name}>
                  {node.name}
                </td>
                <td className="px-3 py-1 text-gray-500 capitalize">
                  {node.node_type.replace(/_/g, " ")}
                </td>
                <td className="px-3 py-1">
                  {info ? (
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${STAGE_DOT_MAP[info.stage]}`} />
                      <span className="text-gray-700">{STAGE_LABEL_MAP[info.stage]}</span>
                    </span>
                  ) : (
                    <span className="text-gray-300">--</span>
                  )}
                </td>
                <td className="px-3 py-1 text-gray-400">
                  {info ? formatDate(info.updatedAt) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
