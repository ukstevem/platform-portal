"use client";

import { useEffect, useState } from "react";
import { supabase } from "@platform/supabase";
import { toISO, getWeekDates } from "@/lib/weekHelpers";
import { calculateBradford, BRADFORD_THRESHOLDS, type BradfordResult } from "@/lib/bradford";
import type { Employee } from "@/lib/types";

type EmployeeStatus = Employee & {
  totalHours: number;
  bradford: BradfordResult;
  approved: boolean;
};

type Props = {
  monday: Date;
  selectedId: string | null;
  onSelect: (emp: Employee) => void;
  refreshKey?: number;
};

export function EmployeeStatusPanel({ monday, selectedId, onSelect, refreshKey }: Props) {
  const [statuses, setStatuses] = useState<EmployeeStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      const weekDates = getWeekDates(monday);
      const weekStart = toISO(weekDates[0]);
      const weekEnd = toISO(weekDates[6]);

      // Fetch all active employees
      const { data: employees } = await supabase
        .from("employees")
        .select("id, first_name, last_name, active")
        .eq("active", true)
        .order("last_name")
        .order("first_name");

      if (cancelled || !employees) return;

      // Fetch all timesheet entries for this week
      const { data: entries } = await supabase
        .from("timesheet_entries")
        .select("employee_id, hours")
        .gte("work_date", weekStart)
        .lte("work_date", weekEnd);

      if (cancelled) return;

      // Fetch all SICK-01 entries for Bradford calculation
      const { data: sickEntries } = await supabase
        .from("timesheet_entries")
        .select("employee_id, work_date")
        .eq("project_item", "SICK-01");

      if (cancelled) return;

      // Fetch approvals for this week
      const { data: approvals } = await supabase
        .from("timesheet_approvals")
        .select("employee_id")
        .eq("week_start", weekStart);

      if (cancelled) return;

      const approvedSet = new Set((approvals ?? []).map((a) => a.employee_id));

      // Sum hours per employee
      const hoursMap = new Map<string, number>();
      for (const e of entries ?? []) {
        hoursMap.set(
          e.employee_id,
          (hoursMap.get(e.employee_id) ?? 0) + Number(e.hours)
        );
      }

      // Group sick dates per employee
      const sickMap = new Map<string, string[]>();
      for (const e of sickEntries ?? []) {
        if (!sickMap.has(e.employee_id)) sickMap.set(e.employee_id, []);
        sickMap.get(e.employee_id)!.push(e.work_date);
      }

      const result: EmployeeStatus[] = employees.map((emp) => ({
        ...emp,
        totalHours: hoursMap.get(emp.id) ?? 0,
        bradford: calculateBradford(sickMap.get(emp.id) ?? []),
        approved: approvedSet.has(emp.id),
      }));

      if (!cancelled) {
        setStatuses(result);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [monday, refreshKey]);

  if (loading) {
    return (
      <div className="border rounded p-3 text-sm text-gray-500">
        Loading employees...
      </div>
    );
  }

  const approved = statuses.filter((s) => s.approved);
  const needsApproval = statuses.filter((s) => !s.approved && s.totalHours > 0);
  const noHours = statuses.filter((s) => !s.approved && s.totalHours === 0);

  const renderEmployee = (emp: EmployeeStatus) => (
    <button
      key={emp.id}
      type="button"
      onClick={() => onSelect(emp)}
      className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between cursor-pointer hover:bg-blue-50 ${
        selectedId === emp.id ? "bg-blue-100" : ""
      }`}
    >
      <span>
        {emp.last_name}, {emp.first_name}
      </span>
      <span className="flex items-center gap-2">
        {emp.bradford.score > 0 && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${BRADFORD_THRESHOLDS[emp.bradford.level].bg} ${BRADFORD_THRESHOLDS[emp.bradford.level].color}`}
            title={`Bradford: ${emp.bradford.score} (${emp.bradford.spells} spell${emp.bradford.spells !== 1 ? "s" : ""}, ${emp.bradford.days} day${emp.bradford.days !== 1 ? "s" : ""})`}
          >
            B:{emp.bradford.score}
          </span>
        )}
        <span className={`text-xs font-medium ${emp.totalHours > 0 ? "text-gray-600" : "text-red-400"}`}>
          {emp.totalHours > 0 ? `${emp.totalHours}h` : "0h"}
        </span>
      </span>
    </button>
  );

  return (
    <div className="border rounded bg-white">
      <div className="px-4 py-2 border-b bg-gray-50 text-sm font-medium">
        Timesheets — {approved.length}/{statuses.length} approved
      </div>
      <div className="max-h-80 overflow-y-auto divide-y">
        {noHours.length > 0 && (
          <>
            <div className="px-4 py-1.5 text-xs text-red-600 font-medium bg-red-50">
              No hours logged ({noHours.length})
            </div>
            {noHours.map(renderEmployee)}
          </>
        )}
        {needsApproval.length > 0 && (
          <>
            <div className="px-4 py-1.5 text-xs text-amber-700 font-medium bg-amber-50">
              Needs approval ({needsApproval.length})
            </div>
            {needsApproval.map(renderEmployee)}
          </>
        )}
        {approved.length > 0 && (
          <>
            <div className="px-4 py-1.5 text-xs text-green-700 font-medium bg-green-50">
              Approved ({approved.length})
            </div>
            {approved.map(renderEmployee)}
          </>
        )}
      </div>
    </div>
  );
}
