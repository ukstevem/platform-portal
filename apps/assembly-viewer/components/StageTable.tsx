"use client";

import { useCallback, useState } from "react";
import { PRODUCTION_STAGES } from "./productionStages";
import type { StageInfo } from "./useNodeStages";
import type { TreeNode } from "./AssemblyTree";
import * as XLSX from "xlsx";

interface StageTableProps {
  sceneNodes: TreeNode[];
  stages: Map<string, StageInfo>;
  projectName?: string;
  assemblyName?: string;
  drawingUrls?: Map<string, string>;
  onRowClick?: (nodeId: string) => void;
  onRowRightClick?: (nodeId: string, pos: { clientX: number; clientY: number }) => void;
  onRowHover?: (nodeId: string | null) => void;
  selectedNodeId?: string | null;
  onFilterChange?: (filter: string | null) => void;
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

function buildRows(sceneNodes: TreeNode[], stages: Map<string, StageInfo>) {
  return sceneNodes.map((node) => {
    const info = stages.get(node.id);
    return {
      name: node.name,
      type: node.node_type.replace(/_/g, " "),
      status: info ? STAGE_LABEL_MAP[info.stage] || info.stage : "",
      updated: info ? formatDate(info.updatedAt) : "",
    };
  });
}

export function StageTable({ sceneNodes, stages, projectName = "", assemblyName = "", drawingUrls, onRowClick, onRowRightClick, onRowHover, selectedNodeId, onFilterChange }: StageTableProps) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  const updateFilter = (f: string | null) => {
    setStageFilter(f);
    onFilterChange?.(f);
  };

  const filteredNodes = sceneNodes.filter((node) => {
    if (stageFilter === null) return true;
    const info = stages.get(node.id);
    if (stageFilter === "none") return !info;
    return info?.stage === stageFilter;
  });

  const handleExcelDownload = useCallback(() => {
    const rows = buildRows(filteredNodes, stages);
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      Name: r.name,
      Type: r.type,
      Status: r.status,
      Updated: r.updated,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Part Status");
    const filename = `${projectName || "status"}_${assemblyName || "parts"}.xlsx`
      .replace(/[^a-zA-Z0-9_\-.]/g, "_");
    XLSX.writeFile(wb, filename);
  }, [sceneNodes, stages, projectName, assemblyName]);

  const handlePdfDownload = useCallback(async () => {
    const rows = buildRows(filteredNodes, stages);
    setPdfLoading(true);
    try {
      const res = await fetch("/assembly/api/export-pdf/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, assemblyName, rows }),
      });
      if (!res.ok) {
        console.error("PDF export failed:", res.statusText);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1]
        || "status.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setPdfLoading(false);
    }
  }, [sceneNodes, stages, projectName, assemblyName]);

  if (sceneNodes.length === 0) return null;

  return (
    <div className="border-t border-gray-200 bg-white overflow-auto max-h-64">
      <div className="sticky top-0 bg-gray-50 border-b border-gray-200 px-3 py-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            className={`px-1.5 py-0.5 text-[10px] rounded ${stageFilter === null ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"}`}
            onClick={() => updateFilter(null)}
          >
            All ({sceneNodes.length})
          </button>
          <button
            className={`px-1.5 py-0.5 text-[10px] rounded ${stageFilter === "none" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"}`}
            onClick={() => updateFilter(stageFilter === "none" ? null : "none")}
          >
            Untagged ({sceneNodes.filter((n) => !stages.get(n.id)).length})
          </button>
          {PRODUCTION_STAGES.map((s) => {
            const count = sceneNodes.filter((n) => stages.get(n.id)?.stage === s.key).length;
            if (count === 0) return null;
            return (
              <button
                key={s.key}
                className={`px-1.5 py-0.5 text-[10px] rounded inline-flex items-center gap-1 ${stageFilter === s.key ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"}`}
                onClick={() => updateFilter(stageFilter === s.key ? null : s.key)}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${stageFilter === s.key ? "bg-white" : s.dotClass}`} />
                {s.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleExcelDownload}
            className="px-2 py-0.5 text-[10px] text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50"
            title="Download as Excel"
          >
            Excel
          </button>
          <button
            onClick={handlePdfDownload}
            disabled={pdfLoading}
            className="px-2 py-0.5 text-[10px] text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            title="Download as PDF"
          >
            {pdfLoading ? "..." : "PDF"}
          </button>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="sticky top-[29px] bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Name</th>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Type</th>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Status</th>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Updated</th>
            <th className="text-left px-3 py-1.5 font-medium text-gray-500">Drawing</th>
          </tr>
        </thead>
        <tbody>
          {sceneNodes.filter((node) => {
            if (stageFilter === null) return true;
            const info = stages.get(node.id);
            if (stageFilter === "none") return !info;
            return info?.stage === stageFilter;
          }).map((node) => {
            const info = stages.get(node.id);
            return (
              <tr
                key={node.id}
                className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${selectedNodeId === node.id ? "bg-blue-50" : ""}`}
                onClick={() => onRowClick?.(node.id)}
                onMouseEnter={() => onRowHover?.(node.id)}
                onMouseLeave={() => onRowHover?.(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onRowRightClick?.(node.id, { clientX: e.clientX, clientY: e.clientY });
                }}
              >
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
                <td className="px-3 py-1">
                  {drawingUrls?.get(node.id) ? (
                    <a
                      href={drawingUrls.get(node.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-gray-300">--</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
