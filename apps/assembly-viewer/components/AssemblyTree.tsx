"use client";

import { useState, useCallback, memo } from "react";
import { PRODUCTION_STAGES } from "./productionStages";
import type { StageInfo } from "./useNodeStages";

export interface TreeNode {
  id: string;
  name: string;
  instance_ref?: string;
  ref_id?: string;
  is_mirrored?: boolean;
  node_type: string;
  solid_count?: number;
  children?: TreeNode[];
  placement?: number[];
}

interface AssemblyTreeProps {
  nodes: TreeNode[];
  stlMap: Record<string, string>;
  onSelect: (nodeId: string) => void;
  onHover: (nodeId: string | null) => void;
  selectedNodeId: string | null;
  sceneMeshIds?: Set<string>;
  nodeStages?: Map<string, StageInfo>;
  onNodeRightClick?: (nodeId: string, pos: { clientX: number; clientY: number }) => void;
}

const BADGE_LABELS: Record<string, string> = {
  assembly: "Assembly",
  part_single_solid: "Part",
  part_multi_solid: "Multi-solid",
  part_no_solid: "No solid",
  solid: "Solid",
};

const BADGE_COLORS: Record<string, string> = {
  assembly: "bg-blue-100 text-blue-700",
  part_single_solid: "bg-green-100 text-green-700",
  part_multi_solid: "bg-amber-100 text-amber-700",
  part_no_solid: "bg-gray-100 text-gray-500",
  solid: "bg-purple-100 text-purple-700",
};

const STAGE_DOT_MAP = Object.fromEntries(
  PRODUCTION_STAGES.map((s) => [s.key, s.dotClass])
);

const TreeNodeRow = memo(function TreeNodeRow({
  node,
  depth,
  stlMap,
  onSelect,
  onHover,
  selectedNodeId,
  sceneMeshIds,
  nodeStages,
  onNodeRightClick,
}: {
  node: TreeNode;
  depth: number;
  stlMap: Record<string, string>;
  onSelect: (nodeId: string) => void;
  onHover: (nodeId: string | null) => void;
  selectedNodeId: string | null;
  sceneMeshIds?: Set<string>;
  nodeStages?: Map<string, StageInfo>;
  onNodeRightClick?: (nodeId: string, pos: { clientX: number; clientY: number }) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  const hasStl = stlMap[node.id] !== undefined;
  const isClickable =
    hasStl ||
    (hasChildren && node.children!.some((c) => stlMap[c.id] !== undefined));
  const isSelected = selectedNodeId === node.id;
  const isHoverable = sceneMeshIds?.has(node.id);
  const stageInfo = nodeStages?.get(node.id);
  const stage = stageInfo?.stage;

  const handleClick = useCallback(() => {
    if (isClickable) onSelect(node.id);
  }, [isClickable, node.id, onSelect]);

  const handleMouseEnter = useCallback(() => {
    if (isHoverable) onHover(node.id);
  }, [isHoverable, node.id, onHover]);

  const handleMouseLeave = useCallback(() => {
    if (isHoverable) onHover(null);
  }, [isHoverable, onHover]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onNodeRightClick || !hasStl) return;
      e.preventDefault();
      e.stopPropagation();
      onNodeRightClick(node.id, { clientX: e.clientX, clientY: e.clientY });
    },
    [onNodeRightClick, hasStl, node.id]
  );

  return (
    <li className="select-none" data-node-id={node.id}>
      <div
        className={[
          "flex items-center gap-1.5 py-0.5 px-1 rounded text-sm cursor-default group",
          "hover:bg-slate-100",
          isClickable ? "cursor-pointer" : "",
          isSelected ? "bg-blue-50 ring-1 ring-blue-300" : "",
        ].join(" ")}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      >
        {/* Toggle arrow */}
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-[10px] text-gray-400 hover:text-gray-700 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Stage dot */}
        {stage && (
          <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_DOT_MAP[stage]}`} />
        )}

        {/* Node name */}
        <span
          className={[
            "truncate",
            isClickable ? "font-medium text-gray-900" : "text-gray-500",
          ].join(" ")}
          title={node.name}
        >
          {node.name}
        </span>

        {/* Instance ref (if different from name) */}
        {node.instance_ref && node.instance_ref !== node.name && (
          <span className="text-xs text-gray-400 truncate" title={node.instance_ref}>
            ({node.instance_ref})
          </span>
        )}

        {/* Type badge */}
        <span
          className={[
            "text-[10px] px-1.5 py-0 rounded-full shrink-0",
            BADGE_COLORS[node.node_type] || "bg-gray-100 text-gray-500",
          ].join(" ")}
        >
          {BADGE_LABELS[node.node_type] || node.node_type}
        </span>

        {/* Solid count */}
        {node.node_type !== "assembly" &&
          node.solid_count !== undefined &&
          node.solid_count > 0 && (
            <span className="text-[10px] text-gray-400 shrink-0">
              {node.solid_count}s
            </span>
          )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <ul>
          {node.children!.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              stlMap={stlMap}
              onSelect={onSelect}
              onHover={onHover}
              selectedNodeId={selectedNodeId}
              sceneMeshIds={sceneMeshIds}
              nodeStages={nodeStages}
              onNodeRightClick={onNodeRightClick}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

export function AssemblyTree({
  nodes,
  stlMap,
  onSelect,
  onHover,
  selectedNodeId,
  sceneMeshIds,
  nodeStages,
  onNodeRightClick,
}: AssemblyTreeProps) {
  return (
    <div className="overflow-auto h-full text-sm">
      <ul>
        {nodes.map((node) => (
          <TreeNodeRow
            key={node.id}
            node={node}
            depth={0}
            stlMap={stlMap}
            onSelect={onSelect}
            onHover={onHover}
            selectedNodeId={selectedNodeId}
            sceneMeshIds={sceneMeshIds}
            nodeStages={nodeStages}
            onNodeRightClick={onNodeRightClick}
          />
        ))}
      </ul>
    </div>
  );
}
