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

/** Walk the tree and collect direct children that have STL files */
function findChildrenWithStl(
  nodes: TreeNode[],
  parentId: string,
  stlMap: Record<string, string>
): TreeNode[] {
  for (const node of nodes) {
    if (node.id === parentId) {
      return (node.children || []).filter((c) => stlMap[c.id]);
    }
    if (node.children) {
      const found = findChildrenWithStl(node.children, parentId, stlMap);
      if (found.length > 0) return found;
    }
  }
  return [];
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
        const children = (node.children || []).filter((c) => data.stl_map[c.id]);
        if (children.length > 0) {
          setViewerStatus(`Loading ${children.length} parts...`);
          const newMeshMap = new Map<string, number>();
          const items: SceneItem[] = children.map((child, i) => {
            newMeshMap.set(child.id, i);
            const stlPath = data.stl_map[child.id];
            // Rewrite /outputs/stl/runId/file.stl -> /assembly/api/stl/runId/file.stl
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
            setViewerStatus(`${node.name} — ${children.length} parts loaded`);
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
          <STLViewerComponent ref={viewerRef} className="absolute inset-0" />
        </div>
      </div>
    </div>
  );
}
