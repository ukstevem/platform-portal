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
}

export function StageContextMenu({
  x,
  y,
  currentStage,
  onSelect,
  onClear,
  onClose,
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
  const menuWidth = 180;
  const menuHeight = PRODUCTION_STAGES.length * 32 + (currentStage ? 40 : 8);
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 select-none"
      style={{ left, top, width: menuWidth }}
    >
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
