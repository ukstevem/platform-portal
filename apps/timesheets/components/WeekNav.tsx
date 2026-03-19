"use client";

import { formatWeekRange } from "@/lib/weekHelpers";

type WeekNavProps = {
  monday: Date;
  onPrev: () => void;
  onNext: () => void;
};

export function WeekNav({ monday, onPrev, onNext }: WeekNavProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onPrev}
        className="rounded border px-3 py-1 text-lg hover:bg-gray-100 cursor-pointer"
        aria-label="Previous week"
      >
        ◀
      </button>
      <span className="text-sm font-medium min-w-[200px] text-center">
        {formatWeekRange(monday)}
      </span>
      <button
        type="button"
        onClick={onNext}
        className="rounded border px-3 py-1 text-lg hover:bg-gray-100 cursor-pointer"
        aria-label="Next week"
      >
        ▶
      </button>
    </div>
  );
}
