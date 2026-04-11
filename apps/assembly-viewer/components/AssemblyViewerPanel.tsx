"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { AssemblyTree, type TreeNode } from "./AssemblyTree";
import {
  STLViewerComponent,
  type STLViewerHandle,
  type SceneItem,
  DEFAULT_COLOR,
  HIGHLIGHT_COLOR,
  DIM_COLOR,
  DIM_OPACITY,
} from "./STLViewer";
import { useNodeStages, type StageInfo } from "./useNodeStages";
import { STAGE_MESH_COLORS, type ProductionStage } from "./productionStages";
import { StageContextMenu } from "./StageContextMenu";
import { StageLegend } from "./StageLegend";
import { StageTable } from "./StageTable";

interface AssemblyData {
  runId: string;
  projectName: string;
  summary: { total_assemblies: number; total_parts: number; total_solids: number };
  assembly_tree: TreeNode[];
  stl_map: Record<string, string>;
}

/**
 * Walk the tree and assign path-based unique IDs to every node.
 * The same sub-assembly reused in multiple places shares raw IDs;
 * prefixing with the parent path makes each instance distinct.
 * Returns a new stl_map keyed by the unique IDs.
 */
function assignUniqueIds(
  nodes: TreeNode[],
  origStlMap: Record<string, string>,
  parentPath = ""
): Record<string, string> {
  const newStlMap: Record<string, string> = {};
  for (const node of nodes) {
    const rawId = node.id;
    const uid = parentPath ? `${parentPath}/${rawId}` : rawId;
    node.id = uid;
    if (origStlMap[rawId]) {
      newStlMap[uid] = origStlMap[rawId];
    }
    if (node.children) {
      Object.assign(newStlMap, assignUniqueIds(node.children, origStlMap, uid));
    }
  }
  return newStlMap;
}

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function canDrillInto(node: TreeNode, stlMap: Record<string, string>): boolean {
  if (!node.children || node.children.length === 0) return false;
  return node.children.some((c) => stlMap[c.id]);
}

/** Collect all descendant node IDs (inclusive) */
function collectDescendantIds(node: TreeNode): string[] {
  const ids = [node.id];
  for (const child of node.children || []) {
    ids.push(...collectDescendantIds(child));
  }
  return ids;
}

function buildPath(nodes: TreeNode[], targetId: string): TreeNode[] {
  for (const node of nodes) {
    if (node.id === targetId) return [node];
    if (node.children) {
      const sub = buildPath(node.children, targetId);
      if (sub.length > 0) return [node, ...sub];
    }
  }
  return [];
}

export function AssemblyViewerPanel() {
  const [data, setData] = useState<AssemblyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [sceneMeshIds, setSceneMeshIds] = useState<Set<string>>(new Set());
  const [viewerStatus, setViewerStatus] = useState<string>("Select an item to preview");
  const [breadcrumb, setBreadcrumb] = useState<TreeNode[]>([]);
  // Clipping
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipAxis, setClipAxis] = useState<"x" | "y" | "z">("x");
  const [clipPosition, setClipPosition] = useState(0);
  const [clipBounds, setClipBounds] = useState<{ min: number; max: number }>({ min: -1000, max: 1000 });
  // Context menu for stage tagging
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  // Drawing generation
  const [drawingLoading, setDrawingLoading] = useState(false);

  const viewerRef = useRef<STLViewerHandle>(null);
  const meshMapRef = useRef<Map<string, number>>(new Map());
  const sceneNodesRef = useRef<TreeNode[]>([]);
  const [tableNodes, setTableNodes] = useState<TreeNode[]>([]);

  // Production stage persistence
  const { stages, setStage, setStageBulk, clearStage } = useNodeStages(data?.runId ?? null);
  // Keep a ref so callbacks can read latest stages without re-creating
  const stagesRef = useRef(stages);
  stagesRef.current = stages;

  /** Get the color a node should be based on its stage (or default) */
  const getNodeColor = useCallback((nodeId: string): number => {
    const info = stagesRef.current.get(nodeId);
    return info ? STAGE_MESH_COLORS[info.stage] : DEFAULT_COLOR;
  }, []);

  /** Apply stage colors to all meshes in the current scene */
  const applyStageColors = useCallback(() => {
    if (!viewerRef.current) return;
    for (const [nid, idx] of meshMapRef.current) {
      viewerRef.current.setMeshColor(idx, getNodeColor(nid), 1.0);
    }
  }, [getNodeColor]);

  useEffect(() => {
    fetch("/assembly/api/assembly-data/")
      .then((r) => r.json())
      .then((d: AssemblyData) => {
        // Rewrite IDs to be unique per-instance (path-based)
        const uniqueStlMap = assignUniqueIds(d.assembly_tree, d.stl_map);
        d.stl_map = uniqueStlMap;
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load assembly data:", err);
        setLoading(false);
      });
  }, []);

  // Re-apply stage colors when stages change (e.g. after initial load from DB)
  useEffect(() => {
    applyStageColors();
  }, [stages, applyStageColors]);

  const loadNodeChildren = useCallback(
    async (node: TreeNode, stlMap: Record<string, string>, limit: number) => {
      if (!viewerRef.current) return;

      const children = (node.children || []).filter((c) => stlMap[c.id]);
      if (children.length === 0) return;

      const loadList = children.length > limit ? children.slice(0, limit) : children;
      const truncated = children.length > limit;

      setViewerStatus(`Loading ${loadList.length}${truncated ? ` of ${children.length}` : ""} parts...`);

      const newMeshMap = new Map<string, number>();
      const items: SceneItem[] = loadList.map((child, i) => {
        newMeshMap.set(child.id, i);
        const stlPath = stlMap[child.id];
        const url = stlPath.replace(/^\/outputs\/stl\//, "/assembly/api/stl/");
        return {
          url,
          color: DEFAULT_COLOR,
          opacity: 1.0,
          label: child.name,
          placement: child.placement,
        };
      });

      meshMapRef.current = newMeshMap;
      sceneNodesRef.current = loadList;
      setTableNodes(loadList);
      setSceneMeshIds(new Set(newMeshMap.keys()));
      setHighlightedNodeId(null);

      try {
        await viewerRef.current.loadScene(items);
        // Apply stage colors after scene loads
        for (const [nid, idx] of newMeshMap) {
          const info = stagesRef.current.get(nid);
          if (info) {
            viewerRef.current.setMeshColor(idx, STAGE_MESH_COLORS[info.stage], 1.0);
          }
        }
        setViewerStatus(
          `${node.name} — ${loadList.length} parts${truncated ? ` (showing ${limit} of ${children.length})` : ""}`
        );
        const bounds = viewerRef.current.getSceneBounds();
        if (bounds) {
          const axisIdx = { x: 0, y: 1, z: 2 }[clipAxis];
          setClipBounds({ min: bounds.min[axisIdx], max: bounds.max[axisIdx] });
          setClipPosition(bounds.max[axisIdx]);
        }
      } catch {
        setViewerStatus("Failed to load some parts");
      }
    },
    [clipAxis]
  );

  const handleSelect = useCallback(
    async (nodeId: string) => {
      if (!data) return;
      setContextMenu(null);
      setSelectedNodeId(nodeId);
      const node = findNode(data.assembly_tree, nodeId);
      if (!node) return;

      const isAssembly = node.node_type === "assembly";
      const isMultiSolid = node.node_type === "part_multi_solid";

      if ((isAssembly || isMultiSolid) && canDrillInto(node, data.stl_map)) {
        setBreadcrumb(buildPath(data.assembly_tree, nodeId));
        await loadNodeChildren(node, data.stl_map, 500);
        return;
      }

      const stlPath = data.stl_map[nodeId];
      if (stlPath && viewerRef.current) {
        setViewerStatus(`Loading ${node.name}...`);
        const url = stlPath.replace(/^\/outputs\/stl\//, "/assembly/api/stl/");
        meshMapRef.current = new Map([[nodeId, 0]]);
        sceneNodesRef.current = [node];
        setTableNodes([node]);
        setSceneMeshIds(new Set([nodeId]));
        setHighlightedNodeId(null);
        setBreadcrumb(buildPath(data.assembly_tree, nodeId));

        try {
          await viewerRef.current.loadScene([
            { url, color: getNodeColor(nodeId), opacity: 1.0, label: node.name },
          ]);
          setViewerStatus(node.name);
        } catch {
          setViewerStatus("Failed to load STL");
        }
      }
    },
    [data, loadNodeChildren, getNodeColor]
  );

  const handleMeshClick = useCallback(
    (meshIndex: number) => {
      if (!data || !viewerRef.current) return;
      setContextMenu(null);
      const meshMap = meshMapRef.current;

      let clickedNodeId: string | null = null;
      for (const [nid, idx] of meshMap) {
        if (idx === meshIndex) { clickedNodeId = nid; break; }
      }
      if (!clickedNodeId) return;

      const node = findNode(data.assembly_tree, clickedNodeId);
      if (!node) return;

      if (canDrillInto(node, data.stl_map)) {
        handleSelect(clickedNodeId);
        return;
      }

      setHighlightedNodeId(clickedNodeId);
      for (const [nid, idx] of meshMap) {
        if (nid === clickedNodeId) {
          viewerRef.current.setMeshColor(idx, HIGHLIGHT_COLOR, 1.0);
        } else {
          viewerRef.current.setMeshColor(idx, DIM_COLOR, DIM_OPACITY);
        }
      }

      setSelectedNodeId(clickedNodeId);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-node-id="${clickedNodeId}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [data, handleSelect]
  );

  // Right-click on mesh in 3D → open stage context menu
  const handleMeshRightClick = useCallback(
    (meshIndex: number, pos: { clientX: number; clientY: number }) => {
      const meshMap = meshMapRef.current;
      let nodeId: string | null = null;
      for (const [nid, idx] of meshMap) {
        if (idx === meshIndex) { nodeId = nid; break; }
      }
      if (nodeId) setContextMenu({ x: pos.clientX, y: pos.clientY, nodeId });
    },
    []
  );

  // Right-click on tree node → open stage context menu
  const handleNodeRightClick = useCallback(
    (nodeId: string, pos: { clientX: number; clientY: number }) => {
      setContextMenu({ x: pos.clientX, y: pos.clientY, nodeId });
    },
    []
  );

  // Stage selected from context menu — cascades to all descendants for assemblies
  const handleStageSelect = useCallback(
    (stage: ProductionStage) => {
      if (!contextMenu || !data) return;
      const { nodeId } = contextMenu;
      const node = findNode(data.assembly_tree, nodeId);
      if (!node) return;

      const hasChildren = node.children && node.children.length > 0;
      if (hasChildren) {
        // Cascade to all descendants
        const allIds = collectDescendantIds(node);
        setStageBulk(allIds, stage);
        // Recolor any visible meshes
        if (viewerRef.current) {
          for (const nid of allIds) {
            const idx = meshMapRef.current.get(nid);
            if (idx !== undefined) {
              viewerRef.current.setMeshColor(idx, STAGE_MESH_COLORS[stage], 1.0);
            }
          }
        }
      } else {
        // Single node
        setStage(nodeId, stage);
        if (viewerRef.current) {
          const meshIdx = meshMapRef.current.get(nodeId);
          if (meshIdx !== undefined) {
            viewerRef.current.setMeshColor(meshIdx, STAGE_MESH_COLORS[stage], 1.0);
          }
        }
      }
      setHighlightedNodeId(null);
    },
    [contextMenu, data, setStage, setStageBulk]
  );

  const handleStageClear = useCallback(() => {
    if (!contextMenu || !viewerRef.current) return;
    const { nodeId } = contextMenu;
    clearStage(nodeId);
    const meshIdx = meshMapRef.current.get(nodeId);
    if (meshIdx !== undefined) {
      viewerRef.current.setMeshColor(meshIdx, DEFAULT_COLOR, 1.0);
    }
    setHighlightedNodeId(null);
  }, [contextMenu, clearStage]);

  /** Check whether a node (or its children for multi-solid) has STL data */
  const nodeHasDrawing = useCallback(
    (nodeId: string): boolean => {
      if (!data) return false;
      if (data.stl_map[nodeId]) return true;
      // Multi-solid parts: check children
      const node = findNode(data.assembly_tree, nodeId);
      if (node?.node_type === "part_multi_solid" && node.children) {
        return node.children.some((c) => data.stl_map[c.id]);
      }
      return false;
    },
    [data]
  );

  /** Request a drawing for a single node and open the PDF */
  const requestDrawing = useCallback(
    async (targetNode: TreeNode, stlPath: string, assemblyName: string) => {
      const rawNodeId = targetNode.id.includes("/")
        ? targetNode.id.split("/").pop()!
        : targetNode.id;

      const res = await fetch("/assembly/api/drawing/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: data!.runId,
          node_id: rawNodeId,
          part_name: targetNode.name,
          assembly_name: assemblyName,
          project_name: data!.projectName,
          stl_path: stlPath,
          placement: targetNode.placement,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Drawing generation failed:", err);
        throw new Error((err as Record<string, string>).error || res.statusText);
      }

      const result = await res.json();
      if (result.download_url) {
        window.open(result.download_url, "_blank");
      }
    },
    [data]
  );

  /** Generate a shop drawing for the context-menu node and open the PDF */
  const handleDrawing = useCallback(async () => {
    if (!contextMenu || !data) return;
    const { nodeId } = contextMenu;

    const node = findNode(data.assembly_tree, nodeId);
    if (!node) return;

    // Parent assembly name from the tree path
    const path = buildPath(data.assembly_tree, nodeId);
    const assemblyName = path.length >= 2 ? path[path.length - 2].name : "";

    setDrawingLoading(true);
    try {
      const stlPath = data.stl_map[nodeId];
      if (stlPath) {
        // Single STL — direct request
        await requestDrawing(node, stlPath, assemblyName);
      } else if (node.node_type === "part_multi_solid" && node.children) {
        // Multi-solid: generate a drawing for each child that has an STL
        const children = node.children.filter((c) => data.stl_map[c.id]);
        if (children.length === 0) return;
        setViewerStatus(`Generating ${children.length} drawings...`);
        await Promise.all(
          children.map((child) =>
            requestDrawing(child, data.stl_map[child.id], node.name)
          )
        );
      }
    } catch (err) {
      console.error("Drawing request error:", err);
      setViewerStatus(
        `Drawing failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    } finally {
      setDrawingLoading(false);
      setContextMenu(null);
    }
  }, [contextMenu, data, requestDrawing]);

  const handleHover = useCallback(
    (nodeId: string | null) => {
      if (!viewerRef.current) return;
      const meshMap = meshMapRef.current;

      if (!nodeId) {
        for (const [nid, idx] of meshMap) {
          if (highlightedNodeId && nid === highlightedNodeId) {
            viewerRef.current.setMeshColor(idx, HIGHLIGHT_COLOR, 1.0);
          } else if (highlightedNodeId) {
            viewerRef.current.setMeshColor(idx, DIM_COLOR, DIM_OPACITY);
          } else {
            // Return to stage color or default
            viewerRef.current.setMeshColor(idx, getNodeColor(nid), 1.0);
          }
        }
        return;
      }

      for (const [nid, idx] of meshMap) {
        if (nid === nodeId) {
          viewerRef.current.setMeshColor(idx, HIGHLIGHT_COLOR, 1.0);
        } else {
          viewerRef.current.setMeshColor(idx, DIM_COLOR, DIM_OPACITY);
        }
      }
    },
    [highlightedNodeId, getNodeColor]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading assembly data...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-500">Failed to load assembly data</p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100%-3rem)] mt-4">
      {/* Tree panel */}
      <div className="w-[380px] shrink-0 border border-gray-200 rounded-lg bg-white overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
          <h2 className="font-semibold text-sm text-gray-700">{data.projectName}</h2>
          <p className="text-xs text-gray-400">
            {data.summary.total_assemblies} assemblies · {data.summary.total_parts} parts · {data.summary.total_solids} solids
          </p>
        </div>
        <div className="flex-1 overflow-auto p-1">
          <AssemblyTree
            nodes={data.assembly_tree}
            stlMap={data.stl_map}
            onSelect={handleSelect}
            onHover={handleHover}
            selectedNodeId={selectedNodeId}
            sceneMeshIds={sceneMeshIds}
            nodeStages={stages}
            onNodeRightClick={handleNodeRightClick}
          />
        </div>
      </div>

      {/* Viewer panel */}
      <div className="flex-1 border border-gray-200 rounded-lg bg-white overflow-hidden flex flex-col">
        {/* Breadcrumb + status */}
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
          {breadcrumb.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-gray-400 mb-1 flex-wrap">
              {breadcrumb.map((crumb, i) => (
                <span key={crumb.id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gray-300">/</span>}
                  <button
                    className="hover:text-blue-600 hover:underline text-gray-500"
                    onClick={() => handleSelect(crumb.id)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-700 truncate">{viewerStatus}</span>
            {breadcrumb.length > 1 && (
              <button
                className="text-xs text-blue-600 hover:underline shrink-0"
                onClick={() => {
                  const parent = breadcrumb[breadcrumb.length - 2];
                  if (parent) handleSelect(parent.id);
                }}
              >
                Back up
              </button>
            )}
          </div>
        </div>
        {/* Legend + clipping controls */}
        {breadcrumb.length > 0 && (
          <>
            <StageLegend />
            <div className="px-3 py-1.5 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={clipEnabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setClipEnabled(on);
                    viewerRef.current?.setClipPlane(clipAxis, clipPosition, on);
                  }}
                  className="accent-blue-600"
                />
                Clip
              </label>
              {clipEnabled && (
                <>
                  <div className="flex gap-1 shrink-0">
                    {(["x", "y", "z"] as const).map((a) => (
                      <button
                        key={a}
                        className={`text-[10px] px-1.5 py-0.5 rounded ${clipAxis === a ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"}`}
                        onClick={() => {
                          setClipAxis(a);
                          const bounds = viewerRef.current?.getSceneBounds();
                          if (bounds) {
                            const idx = { x: 0, y: 1, z: 2 }[a];
                            setClipBounds({ min: bounds.min[idx], max: bounds.max[idx] });
                            const pos = bounds.max[idx];
                            setClipPosition(pos);
                            viewerRef.current?.setClipPlane(a, pos, true);
                          }
                        }}
                      >
                        {a.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={clipBounds.min}
                    max={clipBounds.max}
                    step={(clipBounds.max - clipBounds.min) / 200}
                    value={clipPosition}
                    onChange={(e) => {
                      const pos = Number(e.target.value);
                      setClipPosition(pos);
                      viewerRef.current?.setClipPlane(clipAxis, pos, true);
                    }}
                    className="flex-1 h-1 accent-blue-600"
                  />
                </>
              )}
            </div>
          </>
        )}
        <div className="flex-1 relative min-h-0">
          <STLViewerComponent
            ref={viewerRef}
            className="absolute inset-0"
            onMeshClick={handleMeshClick}
            onMeshRightClick={handleMeshRightClick}
          />
        </div>
        {/* Status table for current scene */}
        {tableNodes.length > 0 && (
          <StageTable sceneNodes={tableNodes} stages={stages} />
        )}
      </div>

      {/* Stage context menu */}
      {contextMenu && (
        <StageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          currentStage={stages.get(contextMenu.nodeId)?.stage ?? null}
          onSelect={handleStageSelect}
          onClear={handleStageClear}
          onClose={() => setContextMenu(null)}
          hasStl={nodeHasDrawing(contextMenu.nodeId)}
          onDrawing={handleDrawing}
          drawingLoading={drawingLoading}
        />
      )}
    </div>
  );
}
