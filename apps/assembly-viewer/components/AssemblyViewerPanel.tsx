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
  classifications: Record<string, string>;
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
  origClassifications: Record<string, string>,
  parentPath = ""
): { stlMap: Record<string, string>; classifications: Record<string, string> } {
  const newStlMap: Record<string, string> = {};
  const newClassifications: Record<string, string> = {};
  for (const node of nodes) {
    const rawId = node.id;
    const uid = parentPath ? `${parentPath}/${rawId}` : rawId;
    node.id = uid;
    if (origStlMap[rawId]) {
      newStlMap[uid] = origStlMap[rawId];
    }
    if (origClassifications[rawId]) {
      newClassifications[uid] = origClassifications[rawId];
    }
    if (node.children) {
      const child = assignUniqueIds(node.children, origStlMap, origClassifications, uid);
      Object.assign(newStlMap, child.stlMap);
      Object.assign(newClassifications, child.classifications);
    }
  }
  return { stlMap: newStlMap, classifications: newClassifications };
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
  const [drawingUrls, setDrawingUrls] = useState<Map<string, string>>(new Map());

  const viewerRef = useRef<STLViewerHandle>(null);
  // Persistent mesh map — nodeId → meshIndex, survives navigation, only grows
  const globalMeshMapRef = useRef<Map<string, number>>(new Map());
  // Which assemblies have been exploded (blob hidden, children shown)
  const explodedNodesRef = useRef<Set<string>>(new Set());
  // Current level: nodeId → meshIndex for hover/highlight
  const meshMapRef = useRef<Map<string, number>>(new Map());
  // Click target: meshIndex → nodeId to use for handleSelect (may differ from mesh's own nodeId)
  const clickTargetRef = useRef<Map<number, string>>(new Map());
  const sceneNodesRef = useRef<TreeNode[]>([]);
  const [tableNodes, setTableNodes] = useState<TreeNode[]>([]);
  // Track if initial scene has been loaded (establishes scene center)
  const sceneInitializedRef = useRef(false);

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

  /** Apply stage colors to all visible meshes in the scene */
  const applyStageColors = useCallback((stageMap: Map<string, StageInfo>) => {
    if (!viewerRef.current) return;
    // Color every mesh that has been loaded (not just current level)
    for (const [nid, idx] of globalMeshMapRef.current) {
      const info = stageMap.get(nid);
      if (info) {
        viewerRef.current.setMeshColor(idx, STAGE_MESH_COLORS[info.stage], 1.0);
      }
    }
  }, []);

  useEffect(() => {
    fetch("/assembly/api/assembly-data/")
      .then((r) => r.json())
      .then((d: AssemblyData) => {
        // Rewrite IDs to be unique per-instance (path-based)
        const result = assignUniqueIds(d.assembly_tree, d.stl_map, d.classifications || {});
        d.stl_map = result.stlMap;
        d.classifications = result.classifications;
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load assembly data:", err);
        setLoading(false);
      });
  }, []);

  // Re-apply stage colors whenever stages OR the scene meshes change
  useEffect(() => {
    applyStageColors(stages);
  }, [stages, sceneMeshIds, applyStageColors]);

  /** Multiply two 4x4 column-major matrices */
  const multiplyMatrices = (a: number[], b: number[]): number[] => {
    const out = new Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return out;
  };

  /**
   * Explode a node: hide its blob, load its children with composed placement.
   * Does NOT change visibility of other meshes.
   */
  const explodeNode = useCallback(
    async (node: TreeNode, stlMap: Record<string, string>) => {
      if (!viewerRef.current || explodedNodesRef.current.has(node.id)) return;

      const children = (node.children || []).filter((c) => stlMap[c.id]);
      if (children.length === 0) return;

      // Hide the parent blob
      const parentIdx = globalMeshMapRef.current.get(node.id);
      if (parentIdx !== undefined) {
        viewerRef.current.setMeshVisible(parentIdx, false);
      }
      explodedNodesRef.current.add(node.id);

      // Figure out which children need loading
      const toLoad = children.filter((c) => globalMeshMapRef.current.get(c.id) === undefined);

      if (toLoad.length > 0) {
        const items: SceneItem[] = toLoad.map((child) => {
          const stlPath = stlMap[child.id];
          const url = stlPath.replace(/^\/outputs\/stl\//, "/assembly/api/stl/");

          // Compose parent × child placement for correct world position
          let placement = child.placement;
          if (node.placement && node.placement.length === 16) {
            if (child.placement && child.placement.length === 16) {
              placement = multiplyMatrices(node.placement, child.placement);
            } else {
              placement = node.placement;
            }
          }

          return { url, color: DEFAULT_COLOR, opacity: 1.0, label: child.name, placement };
        });

        if (!sceneInitializedRef.current) {
          await viewerRef.current.loadScene(items);
          sceneInitializedRef.current = true;
          toLoad.forEach((child, i) => globalMeshMapRef.current.set(child.id, i));
        } else {
          const startIdx = await viewerRef.current.addMeshes(items);
          toLoad.forEach((child, i) => globalMeshMapRef.current.set(child.id, startIdx + i));
        }
      }
    },
    []
  );

  /**
   * Recursively collect all visible leaf mesh indices under a node,
   * following explosions. Returns [meshIndex, leafNodeId] pairs.
   */
  const collectLeafMeshes = useCallback(
    (node: TreeNode, stlMap: Record<string, string>): Array<[number, string]> => {
      const result: Array<[number, string]> = [];
      const children = (node.children || []).filter((c) => stlMap[c.id]);
      for (const child of children) {
        if (explodedNodesRef.current.has(child.id)) {
          // Recursively collect from exploded children
          result.push(...collectLeafMeshes(child, stlMap));
        } else {
          const idx = globalMeshMapRef.current.get(child.id);
          if (idx !== undefined) result.push([idx, child.id]);
        }
      }
      return result;
    },
    []
  );

  /**
   * Show a level: hide everything, then show the correct meshes for this
   * parent's children (respecting explosions). Build click targets.
   */
  const showLevel = useCallback(
    async (parentNode: TreeNode, stlMap: Record<string, string>) => {
      if (!viewerRef.current) return;

      const children = (parentNode.children || []).filter((c) => stlMap[c.id]);
      if (children.length === 0) return;

      const MAX_PARTS = 500;
      const loadList = children.length > MAX_PARTS ? children.slice(0, MAX_PARTS) : children;
      const truncated = children.length > MAX_PARTS;

      // Hide everything first
      viewerRef.current.hideAll();

      // Load blobs for any non-exploded children that aren't in the scene yet
      const toLoad = loadList.filter(
        (c) => !explodedNodesRef.current.has(c.id) && globalMeshMapRef.current.get(c.id) === undefined
      );

      if (toLoad.length > 0) {
        setViewerStatus(`Loading ${toLoad.length} parts...`);
        const items: SceneItem[] = toLoad.map((child) => {
          const stlPath = stlMap[child.id];
          const url = stlPath.replace(/^\/outputs\/stl\//, "/assembly/api/stl/");
          return { url, color: DEFAULT_COLOR, opacity: 1.0, label: child.name, placement: child.placement };
        });

        if (!sceneInitializedRef.current) {
          await viewerRef.current.loadScene(items);
          sceneInitializedRef.current = true;
          toLoad.forEach((child, i) => globalMeshMapRef.current.set(child.id, i));
        } else {
          const startIdx = await viewerRef.current.addMeshes(items);
          toLoad.forEach((child, i) => globalMeshMapRef.current.set(child.id, startIdx + i));
        }
      }

      // Recursively auto-explode assemblies with mixed descendant stages
      // Keeps going until every visible node is either a leaf, a uniform blob, or fully exploded
      const stageMap = stagesRef.current;

      const autoExplode = async (nodes: TreeNode[]) => {
        for (const child of nodes) {
          if (explodedNodesRef.current.has(child.id)) continue;
          if (!child.children || child.children.length === 0) continue;
          if (!child.children.some((c) => stlMap[c.id])) continue;

          const descendants = collectDescendantIds(child);
          let firstStage: string | null | undefined = undefined;
          let mixed = false;
          for (const did of descendants) {
            const s = stageMap.get(did)?.stage ?? null;
            if (firstStage === undefined) {
              firstStage = s;
            } else if (s !== firstStage) {
              mixed = true;
              break;
            }
          }

          if (mixed) {
            await explodeNode(child, stlMap);
            // Recurse into the newly loaded children
            const subChildren = child.children.filter((c) => stlMap[c.id]);
            await autoExplode(subChildren);
          }
        }
      };

      await autoExplode(loadList);

      // Build visibility and interaction maps
      const visibleIndices: number[] = [];
      const visibleMeshMap = new Map<string, number>();
      const newClickTarget = new Map<number, string>();

      for (const child of loadList) {
        if (explodedNodesRef.current.has(child.id)) {
          // Exploded: show leaf meshes, click targets point to this assembly
          const leaves = collectLeafMeshes(child, stlMap);
          for (const [meshIdx, leafId] of leaves) {
            visibleIndices.push(meshIdx);
            newClickTarget.set(meshIdx, child.id);
            const info = stageMap.get(leafId);
            if (info) {
              viewerRef.current.setMeshColor(meshIdx, STAGE_MESH_COLORS[info.stage], 1.0);
            } else {
              viewerRef.current.setMeshColor(meshIdx, DEFAULT_COLOR, 1.0);
            }
          }
          if (leaves.length > 0) {
            visibleMeshMap.set(child.id, leaves[0][0]);
          }
        } else {
          // Blob (uniform or untagged) or leaf part
          const idx = globalMeshMapRef.current.get(child.id);
          if (idx === undefined) continue;

          visibleIndices.push(idx);
          visibleMeshMap.set(child.id, idx);
          newClickTarget.set(idx, child.id);

          // Color: own stage, or uniform descendant stage, or default
          const info = stageMap.get(child.id);
          if (info) {
            viewerRef.current.setMeshColor(idx, STAGE_MESH_COLORS[info.stage], 1.0);
          } else if (child.children && child.children.length > 0) {
            // Uniform — all descendants have the same stage (checked above, not mixed)
            const descendants = collectDescendantIds(child);
            let uniformStage: ProductionStage | null = null;
            for (const did of descendants) {
              const dInfo = stageMap.get(did);
              if (dInfo) { uniformStage = dInfo.stage; break; }
            }
            if (uniformStage) {
              viewerRef.current.setMeshColor(idx, STAGE_MESH_COLORS[uniformStage], 1.0);
            } else {
              viewerRef.current.setMeshColor(idx, DEFAULT_COLOR, 1.0);
            }
          } else {
            viewerRef.current.setMeshColor(idx, DEFAULT_COLOR, 1.0);
          }
        }
      }

      viewerRef.current.showByIndices(visibleIndices);
      viewerRef.current.fitToVisible();

      meshMapRef.current = visibleMeshMap;
      clickTargetRef.current = newClickTarget;
      sceneNodesRef.current = loadList;
      setTableNodes(loadList);
      setSceneMeshIds(new Set(visibleMeshMap.keys()));
      setHighlightedNodeId(null);

      setViewerStatus(
        `${parentNode.name} — ${loadList.length} parts${truncated ? ` (first ${MAX_PARTS} of ${children.length})` : ""}`
      );
    },
    [collectLeafMeshes]
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
        // Explode this node if not already (loads its children into the scene)
        await explodeNode(node, data.stl_map);
        setBreadcrumb(buildPath(data.assembly_tree, nodeId));
        // Show this level (hides everything else, shows this node's children)
        await showLevel(node, data.stl_map);
        return;
      }

      // Leaf part — highlight it, don't change the view
      const meshIdx = meshMapRef.current.get(nodeId);
      if (meshIdx !== undefined && viewerRef.current) {
        setHighlightedNodeId(nodeId);
        for (const [nid, idx] of meshMapRef.current) {
          if (nid === nodeId) {
            viewerRef.current.setMeshColor(idx, HIGHLIGHT_COLOR, 1.0);
          } else {
            viewerRef.current.setMeshColor(idx, DIM_COLOR, DIM_OPACITY);
          }
        }
      }
    },
    [data, explodeNode, showLevel]
  );

  const handleMeshClick = useCallback(
    (meshIndex: number) => {
      if (!data || !viewerRef.current) return;
      setContextMenu(null);

      // Use click target map to find the correct node for this mesh
      const targetNodeId = clickTargetRef.current.get(meshIndex);
      if (!targetNodeId) return;

      const node = findNode(data.assembly_tree, targetNodeId);
      if (!node) return;

      if (canDrillInto(node, data.stl_map)) {
        handleSelect(targetNodeId);
        return;
      }

      // Leaf part — highlight
      setHighlightedNodeId(targetNodeId);
      setSelectedNodeId(targetNodeId);
      const meshMap = meshMapRef.current;
      for (const [nid, idx] of meshMap) {
        if (nid === targetNodeId) {
          viewerRef.current.setMeshColor(idx, HIGHLIGHT_COLOR, 1.0);
        } else {
          viewerRef.current.setMeshColor(idx, DIM_COLOR, DIM_OPACITY);
        }
      }

      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-node-id="${targetNodeId}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [data, handleSelect]
  );

  // Right-click on mesh in 3D → open stage context menu
  const handleMeshRightClick = useCallback(
    (meshIndex: number, pos: { clientX: number; clientY: number }) => {
      const nodeId = clickTargetRef.current.get(meshIndex);
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

  // Table row click → highlight the part in the 3D viewer
  const handleTableRowClick = useCallback(
    (nodeId: string) => {
      if (!viewerRef.current) return;
      setContextMenu(null);
      const meshMap = meshMapRef.current;
      const meshIdx = meshMap.get(nodeId);
      if (meshIdx === undefined) return;

      setHighlightedNodeId(nodeId);
      setSelectedNodeId(nodeId);
      for (const [nid, idx] of meshMap) {
        if (nid === nodeId) {
          viewerRef.current.setMeshColor(idx, HIGHLIGHT_COLOR, 1.0);
        } else {
          viewerRef.current.setMeshColor(idx, DIM_COLOR, DIM_OPACITY);
        }
      }

      // Scroll tree to the node
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
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

  /** Check whether a node (or its children for multi-solid) can have a drawing generated */
  const nodeHasDrawing = useCallback(
    (nodeId: string): boolean => {
      if (!data) return false;

      // If any ancestor is classified as bought-out/exclude, or manually
      // staged as bought_out, suppress drawings on descendants.
      // Only the classified/staged node itself may have a drawing generated.
      const path = buildPath(data.assembly_tree, nodeId);
      for (let i = 0; i < path.length - 1; i++) {
        const ancestorId = path[i].id;
        const cls = data.classifications[ancestorId];
        if (cls === "bought-out" || cls === "exclude") return false;
        if (stages.get(ancestorId)?.stage === "bought_out") return false;
      }

      if (data.stl_map[nodeId]) return true;
      const node = findNode(data.assembly_tree, nodeId);
      if (!node?.children) return false;
      // Multi-solid parts: check children for individual STLs
      if (node.node_type === "part_multi_solid") {
        return node.children.some((c) => data.stl_map[c.id]);
      }
      // Assemblies: check if any children have STLs
      if (node.node_type === "assembly") {
        return node.children.some((c) => data.stl_map[c.id] ||
          (c.node_type === "part_multi_solid" && c.children?.some((s) => data.stl_map[s.id])));
      }
      return false;
    },
    [data, stages]
  );

  /** Request a drawing for a single node — returns { nodeId, url } */
  const requestDrawing = useCallback(
    async (targetNode: TreeNode, stlPath: string, assemblyName: string, placement?: number[]): Promise<{ nodeId: string; url: string } | null> => {
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
          placement: placement ?? targetNode.placement,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Drawing generation failed:", err);
        throw new Error((err as Record<string, string>).error || res.statusText);
      }

      const result = await res.json();
      return result.download_url ? { nodeId: targetNode.id, url: result.download_url } : null;
    },
    [data]
  );

  /** Collect drawing requests for a node and all relevant children */
  const collectDrawingRequests = useCallback(
    (node: TreeNode, assemblyName: string): Promise<{ nodeId: string; url: string } | null>[] => {
      if (!data) return [];
      const requests: Promise<{ nodeId: string; url: string } | null>[] = [];

      if (node.node_type === "assembly" && node.children) {
        // Assembly: generate for the assembly itself + all children
        if (data.stl_map[node.id]) {
          requests.push(requestDrawing(node, data.stl_map[node.id], assemblyName));
        }
        for (const child of node.children) {
          if (child.node_type === "part_multi_solid" && child.children) {
            const solids = child.children.filter((s) => data.stl_map[s.id]);
            if (solids.length > 0) {
              for (const solid of solids) {
                requests.push(requestDrawing(solid, data.stl_map[solid.id], child.name, child.placement));
              }
            } else if (data.stl_map[child.id]) {
              requests.push(requestDrawing(child, data.stl_map[child.id], node.name, child.placement));
            }
          } else if (data.stl_map[child.id]) {
            requests.push(requestDrawing(child, data.stl_map[child.id], node.name));
          }
        }
      } else if (node.node_type === "part_multi_solid" && node.children) {
        const children = node.children.filter((c) => data.stl_map[c.id]);
        if (children.length > 0) {
          for (const child of children) {
            requests.push(requestDrawing(child, data.stl_map[child.id], node.name, node.placement));
          }
        } else if (data.stl_map[node.id]) {
          requests.push(requestDrawing(node, data.stl_map[node.id], assemblyName));
        }
      } else if (data.stl_map[node.id]) {
        requests.push(requestDrawing(node, data.stl_map[node.id], assemblyName));
      }

      return requests;
    },
    [data, requestDrawing]
  );

  /** Generate shop drawings for the context-menu node and open/store results */
  const handleDrawing = useCallback(async () => {
    if (!contextMenu || !data) return;
    const { nodeId } = contextMenu;

    const node = findNode(data.assembly_tree, nodeId);
    if (!node) return;

    const path = buildPath(data.assembly_tree, nodeId);
    const assemblyName = path.length >= 2 ? path[path.length - 2].name : "";

    const requests = collectDrawingRequests(node, assemblyName);
    if (requests.length === 0) return;

    const isBatch = requests.length > 1;
    if (isBatch) {
      setViewerStatus(`Generating ${requests.length} drawings...`);
    }

    setDrawingLoading(true);
    try {
      const results = await Promise.all(requests);
      const newUrls = new Map(drawingUrls);
      for (const r of results) {
        if (r) newUrls.set(r.nodeId, r.url);
      }
      setDrawingUrls(newUrls);

      if (isBatch) {
        setViewerStatus(`${results.filter(Boolean).length} drawings ready`);
      } else if (results[0]?.url) {
        // Single drawing — open in new tab
        window.open(results[0].url, "_blank");
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
  }, [contextMenu, data, collectDrawingRequests, drawingUrls]);

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
        <div className="flex-1 relative min-h-0 overflow-hidden">
          <STLViewerComponent
            ref={viewerRef}
            className="absolute inset-0"
            onMeshClick={handleMeshClick}
            onMeshRightClick={handleMeshRightClick}
          />
        </div>
        {/* Status table for current scene */}
        {tableNodes.length > 0 && (
          <StageTable
            sceneNodes={tableNodes}
            stages={stages}
            projectName={data?.projectName}
            assemblyName={breadcrumb[breadcrumb.length - 1]?.name}
            drawingUrls={drawingUrls}
            onRowClick={handleTableRowClick}
            onRowHover={handleHover}
            onRowRightClick={handleNodeRightClick}
            selectedNodeId={highlightedNodeId}
            onFilterChange={(filter) => {
              if (!viewerRef.current) return;
              for (const [nid, idx] of meshMapRef.current) {
                if (filter === null) {
                  viewerRef.current.setMeshVisible(idx, true);
                } else if (filter === "none") {
                  viewerRef.current.setMeshVisible(idx, !stages.get(nid));
                } else {
                  viewerRef.current.setMeshVisible(idx, stages.get(nid)?.stage === filter);
                }
              }
            }}
          />
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
