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
import { useNodeStages } from "./useNodeStages";
import { STAGE_MESH_COLORS, type ProductionStage } from "./productionStages";
import { StageContextMenu } from "./StageContextMenu";
import { StageLegend } from "./StageLegend";

interface AssemblyData {
  runId: string;
  projectName: string;
  summary: { total_assemblies: number; total_parts: number; total_solids: number };
  assembly_tree: TreeNode[];
  stl_map: Record<string, string>;
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

  const viewerRef = useRef<STLViewerHandle>(null);
  const meshMapRef = useRef<Map<string, number>>(new Map());
  const sceneNodesRef = useRef<TreeNode[]>([]);

  // Production stage persistence
  const { stages, setStage, clearStage } = useNodeStages(data?.runId ?? null);
  // Keep a ref so callbacks can read latest stages without re-creating
  const stagesRef = useRef(stages);
  stagesRef.current = stages;

  /** Get the color a node should be based on its stage (or default) */
  const getNodeColor = useCallback((nodeId: string): number => {
    const stage = stagesRef.current.get(nodeId);
    return stage ? STAGE_MESH_COLORS[stage] : DEFAULT_COLOR;
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
      setSceneMeshIds(new Set(newMeshMap.keys()));
      setHighlightedNodeId(null);

      try {
        await viewerRef.current.loadScene(items);
        // Apply stage colors after scene loads
        for (const [nid, idx] of newMeshMap) {
          const stage = stagesRef.current.get(nid);
          if (stage) {
            viewerRef.current.setMeshColor(idx, STAGE_MESH_COLORS[stage], 1.0);
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

  // Stage selected from context menu
  const handleStageSelect = useCallback(
    (stage: ProductionStage) => {
      if (!contextMenu || !viewerRef.current) return;
      const { nodeId } = contextMenu;
      setStage(nodeId, stage);
      // Immediately recolor the mesh if it's in the current scene
      const meshIdx = meshMapRef.current.get(nodeId);
      if (meshIdx !== undefined) {
        viewerRef.current.setMeshColor(meshIdx, STAGE_MESH_COLORS[stage], 1.0);
      }
      setHighlightedNodeId(null);
    },
    [contextMenu, setStage]
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
        <div className="flex-1 relative">
          <STLViewerComponent
            ref={viewerRef}
            className="absolute inset-0"
            onMeshClick={handleMeshClick}
            onMeshRightClick={handleMeshRightClick}
          />
        </div>
      </div>

      {/* Stage context menu */}
      {contextMenu && (
        <StageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          currentStage={stages.get(contextMenu.nodeId) ?? null}
          onSelect={handleStageSelect}
          onClear={handleStageClear}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
