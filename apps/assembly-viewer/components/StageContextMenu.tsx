"use client";

import { useEffect, useRef } from "react";
import { PRODUCTION_STAGES, type ProductionStage } from "./productionStages";

interface StageContextMenuProps {
  x: number;
  y: number;
  currentStage: ProductionStage | null;
  onSelect: (stage: ProductionStage) => void;
  onClear: () => void;
  onClose: () => void;
  /** Show "View Shop Drawing" option (only for parts with STL) */
  hasStl?: boolean;
  onDrawing?: () => void;
  drawingLoading?: boolean;
}

export function StageContextMenu({
  x,
  y,
  currentStage,
  onSelect,
  onClear,
  onClose,
  hasStl,
  onDrawing,
  drawingLoading,
}: StageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Keep menu on-screen
  const menuWidth = 200;
  const drawingHeight = hasStl ? 40 : 0;
  const menuHeight = PRODUCTION_STAGES.length * 32 + (currentStage ? 40 : 8) + drawingHeight;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 select-none"
      style={{ left, top, width: menuWidth }}
    >
      {hasStl && onDrawing && (
        <>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            disabled={drawingLoading}
            onClick={() => {
              onDrawing();
            }}
          >
            <svg className="w-4 h-4 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <span className="flex-1 text-left font-medium">
              {drawingLoading ? "Generating..." : "View Shop Drawing"}
            </span>
          </button>
          <div className="border-t border-gray-100 my-1" />
        </>
      )}
      <div className="px-3 py-1 text-[10px] text-gray-400 uppercase tracking-wide">
        Production Stage
      </div>
      {PRODUCTION_STAGES.map((stage) => (
        <button
          key={stage.key}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          onClick={() => {
            onSelect(stage.key);
            onClose();
          }}
        >
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${stage.dotClass}`} />
          <span className="flex-1 text-left">{stage.label}</span>
          {currentStage === stage.key && (
            <span className="text-blue-600 text-xs">&#10003;</span>
          )}
        </button>
      ))}
      {currentStage && (
        <>
          <div className="border-t border-gray-100 my-1" />
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50"
            onClick={() => {
              onClear();
              onClose();
            }}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-gray-300" />
            <span className="flex-1 text-left">Clear</span>
          </button>
        </>
      )}
    </div>
  );
}
