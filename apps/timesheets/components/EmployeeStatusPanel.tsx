"use client";

import { useEffect, useState } from "react";
import { supabase } from "@platform/supabase";
import { toISO, getWeekDates } from "@/lib/weekHelpers";
import { calculateBradford, BRADFORD_THRESHOLDS, type BradfordResult } from "@/lib/bradford";
import type { Employee } from "@/lib/types";

const VARIANCE_EXCLUDED_ITEMS = new Set(["SICK-01", "HOLIDAY-01", "TRAINING-01"]);

function formatSignedDecimalHours(minutes: number): string {
  if (minutes === 0) return "0.00";
  const sign = minutes > 0 ? "+" : "−";
  return `${sign}${(Math.abs(minutes) / 60).toFixed(2)}`;
}

function formatHM(minutes: number, signed = false): string {
  const sign = minutes < 0 ? "−" : signed && minutes > 0 ? "+" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}

// Weekly variance colour bands for the panel badge. Only amber/red
// because the badge only renders when |variance| > 30 min anyway.
function weeklyVarianceBadgeClass(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs <= 60) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

type WeekVariance = {
  clockedMinutes: number;
  allocatedMinutes: number;
  varianceMinutes: number;
  incompleteClocking: boolean;
};

type EmployeeStatus = Employee & {
  totalHours: number;
  bradford: BradfordResult;
  approved: boolean;
  variance: WeekVariance | null; // null when no taps that week (no comparison)
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

      // Fetch all timesheet entries for this week (project_item needed
      // to exclude SICK/HOLIDAY/TRAINING from the variance allocation total)
      const { data: entries } = await supabase
        .from("timesheet_entries")
        .select("employee_id, hours, project_item")
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

      // Fetch presence (clocked) data for the week from the presence
      // schema's RPC. Read-only consumption — no presence-side changes.
      const { data: presenceRows } = await supabase.rpc(
        "employees_daily_hours",
        { p_start_date: weekStart, p_end_date: weekEnd }
      );

      if (cancelled) return;

      const approvedSet = new Set((approvals ?? []).map((a) => a.employee_id));

      // Sum hours per employee (full total, for the existing hours pill).
      const hoursMap = new Map<string, number>();
      // Sum allocated work minutes per employee (excludes SICK/HOLIDAY/TRAINING).
      const allocatedWorkMinutesMap = new Map<string, number>();
      for (const e of entries ?? []) {
        hoursMap.set(
          e.employee_id,
          (hoursMap.get(e.employee_id) ?? 0) + Number(e.hours)
        );
        if (!VARIANCE_EXCLUDED_ITEMS.has(e.project_item)) {
          allocatedWorkMinutesMap.set(
            e.employee_id,
            (allocatedWorkMinutesMap.get(e.employee_id) ?? 0) +
              Math.round(Number(e.hours) * 60)
          );
        }
      }

      // Aggregate presence per employee for the week.
      const presenceMap = new Map<
        string,
        { clockedMinutes: number; hasAnyTap: boolean; incompleteClocking: boolean }
      >();
      for (const r of (presenceRows ?? []) as Array<{
        employee_id: string;
        worked_minutes: number | null;
        tap_count: number | null;
        missed_clock_in: boolean | null;
        missed_clock_out: boolean | null;
      }>) {
        const cur = presenceMap.get(r.employee_id) ?? {
          clockedMinutes: 0,
          hasAnyTap: false,
          incompleteClocking: false,
        };
        cur.clockedMinutes += r.worked_minutes ?? 0;
        if ((r.tap_count ?? 0) > 0) cur.hasAnyTap = true;
        if (r.missed_clock_in || r.missed_clock_out) cur.incompleteClocking = true;
        presenceMap.set(r.employee_id, cur);
      }

      // Group sick dates per employee
      const sickMap = new Map<string, string[]>();
      for (const e of sickEntries ?? []) {
        if (!sickMap.has(e.employee_id)) sickMap.set(e.employee_id, []);
        sickMap.get(e.employee_id)!.push(e.work_date);
      }

      const result: EmployeeStatus[] = employees.map((emp) => {
        const presence = presenceMap.get(emp.id);
        const allocated = allocatedWorkMinutesMap.get(emp.id) ?? 0;
        const variance: WeekVariance | null = presence?.hasAnyTap
          ? {
              clockedMinutes: presence.clockedMinutes,
              allocatedMinutes: allocated,
              varianceMinutes: presence.clockedMinutes - allocated,
              incompleteClocking: presence.incompleteClocking,
            }
          : null;
        return {
          ...emp,
          totalHours: hoursMap.get(emp.id) ?? 0,
          bradford: calculateBradford(sickMap.get(emp.id) ?? []),
          approved: approvedSet.has(emp.id),
          variance,
        };
      });

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
        {emp.variance && Math.abs(emp.variance.varianceMinutes) > 30 && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${weeklyVarianceBadgeClass(emp.variance.varianceMinutes)}`}
            title={`Clocked ${formatHM(emp.variance.clockedMinutes)}, Allocated ${formatHM(emp.variance.allocatedMinutes)}, Variance ${formatHM(emp.variance.varianceMinutes, true)}${emp.variance.incompleteClocking ? " — incomplete clocking" : ""}`}
          >
            Δ{formatSignedDecimalHours(emp.variance.varianceMinutes)}h
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
