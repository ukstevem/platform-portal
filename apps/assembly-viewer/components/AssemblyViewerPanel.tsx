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

interface AssemblyData {
  runId: string;
  projectName: string;
  summary: { total_assemblies: number; total_parts: number; total_solids: number };
  assembly_tree: TreeNode[];
  stl_map: Record<string, string>;
}

/**
 * Collect all descendant nodes that have STL files under a given node.
 * Walks depth-first: if a child has an STL, include it; if it's an assembly
 * without an STL, recurse into its children.
 */
function collectStlDescendants(
  node: TreeNode,
  stlMap: Record<string, string>
): TreeNode[] {
  const result: TreeNode[] = [];
  for (const child of node.children || []) {
    if (stlMap[child.id]) {
      result.push(child);
    } else if (child.children && child.children.length > 0) {
      result.push(...collectStlDescendants(child, stlMap));
    }
  }
  return result;
}

/** Find a node by ID in the tree */
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

export function AssemblyViewerPanel() {
  const [data, setData] = useState<AssemblyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sceneMeshIds, setSceneMeshIds] = useState<Set<string>>(new Set());
  const [viewerStatus, setViewerStatus] = useState<string>("Select an item to preview");

  const viewerRef = useRef<STLViewerHandle>(null);
  // Map nodeId → mesh index for hover highlighting
  const meshMapRef = useRef<Map<string, number>>(new Map());

  // Load sample data
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

  const handleSelect = useCallback(
    async (nodeId: string) => {
      if (!data || !viewerRef.current) return;

      setSelectedNodeId(nodeId);
      const node = findNode(data.assembly_tree, nodeId);
      if (!node) return;

      const isAssembly = node.node_type === "assembly";
      const isMultiSolid = node.node_type === "part_multi_solid";

      // For assemblies or multi-solid parts, load children as a scene
      if (isAssembly || isMultiSolid) {
        const children = collectStlDescendants(node, data.stl_map);
        if (children.length > 0) {
          // Cap at 200 parts to avoid browser overload
          const MAX_PARTS = 200;
          const loadList = children.length > MAX_PARTS ? children.slice(0, MAX_PARTS) : children;
          const truncated = children.length > MAX_PARTS;

          setViewerStatus(`Loading ${loadList.length}${truncated ? ` of ${children.length}` : ""} parts...`);
          const newMeshMap = new Map<string, number>();
          const items: SceneItem[] = loadList.map((child, i) => {
            newMeshMap.set(child.id, i);
            const stlPath = data.stl_map[child.id];
            const url = stlPath.replace(
              /^\/outputs\/stl\//,
              "/assembly/api/stl/"
            );
            return {
              url,
              color: DEFAULT_COLOR,
              opacity: 1.0,
              label: child.name,
              placement: child.placement,
            };
          });

          meshMapRef.current = newMeshMap;
          setSceneMeshIds(new Set(newMeshMap.keys()));

          try {
            await viewerRef.current.loadScene(items);
            setViewerStatus(
              `${node.name} — ${loadList.length} parts loaded${truncated ? ` (${children.length} total, showing first ${MAX_PARTS})` : ""}`
            );
          } catch {
            setViewerStatus("Failed to load some parts");
          }
          return;
        }
      }

      // Single part — load just its STL
      const stlPath = data.stl_map[nodeId];
      if (stlPath) {
        setViewerStatus(`Loading ${node.name}...`);
        const url = stlPath.replace(/^\/outputs\/stl\//, "/assembly/api/stl/");
        meshMapRef.current = new Map([[nodeId, 0]]);
        setSceneMeshIds(new Set([nodeId]));

        try {
          await viewerRef.current.loadScene([
            { url, color: DEFAULT_COLOR, opacity: 1.0, label: node.name },
          ]);
          setViewerStatus(node.name);
        } catch {
          setViewerStatus("Failed to load STL");
        }
      }
    },
    [data]
  );

  const handleMeshClick = useCallback(
    (meshIndex: number) => {
      if (!viewerRef.current) return;
      const meshMap = meshMapRef.current;

      // Reverse lookup: mesh index → node ID
      let clickedNodeId: string | null = null;
      for (const [nid, idx] of meshMap) {
        if (idx === meshIndex) {
          clickedNodeId = nid;
          break;
        }
      }
      if (!clickedNodeId) return;

      // Highlight the clicked mesh, dim others
      for (const [nid, idx] of meshMap) {
        if (nid === clickedNodeId) {
          viewerRef.current.setMeshColor(idx, HIGHLIGHT_COLOR, 1.0);
        } else {
          viewerRef.current.setMeshColor(idx, DIM_COLOR, DIM_OPACITY);
        }
      }

      // Scroll the tree node into view
      setSelectedNodeId(clickedNodeId);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-node-id="${clickedNodeId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    },
    []
  );

  const handleHover = useCallback(
    (nodeId: string | null) => {
      if (!viewerRef.current) return;
      const meshMap = meshMapRef.current;

      if (!nodeId) {
        // Unhighlight all — restore defaults
        for (const [, idx] of meshMap) {
          viewerRef.current.setMeshColor(idx, DEFAULT_COLOR, 1.0);
        }
        return;
      }

      // Highlight hovered, dim others
      for (const [nid, idx] of meshMap) {
        if (nid === nodeId) {
          viewerRef.current.setMeshColor(idx, HIGHLIGHT_COLOR, 1.0);
        } else {
          viewerRef.current.setMeshColor(idx, DIM_COLOR, DIM_OPACITY);
        }
      }
    },
    []
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
          <h2 className="font-semibold text-sm text-gray-700">
            {data.projectName}
          </h2>
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
          />
        </div>
      </div>

      {/* Viewer panel */}
      <div className="flex-1 border border-gray-200 rounded-lg bg-white overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{viewerStatus}</span>
        </div>
        <div className="flex-1 relative">
          <STLViewerComponent ref={viewerRef} className="absolute inset-0" onMeshClick={handleMeshClick} />
        </div>
      </div>
    </div>
  );
}
