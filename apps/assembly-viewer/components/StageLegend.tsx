"use client";

import { PRODUCTION_STAGES } from "./productionStages";

export function StageLegend() {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200 bg-gray-50 flex-wrap">
      <span className="text-[10px] text-gray-400 uppercase tracking-wide shrink-0">Stages</span>
      {PRODUCTION_STAGES.map((stage) => (
        <span key={stage.key} className="flex items-center gap-1 text-xs text-gray-600">
          <span className={`w-2 h-2 rounded-full ${stage.dotClass}`} />
          {stage.label}
        </span>
      ))}
    </div>
  );
}
