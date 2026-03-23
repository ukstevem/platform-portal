"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { getMonday, toISO, formatWeekRange, getWeekDates } from "@/lib/weekHelpers";
import { exportPDF, exportXLSX } from "@/lib/wageExport";

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  payroll_id: string | null;
  team: string;
  active: boolean;
};

type TimesheetHours = {
  employee_id: string;
  work_date: string;
  hours: number;
  project_item: string;
  is_overtime: boolean;
};

type WagePrepEntry = {
  employee_id: string;
  week_start: string;
  travel_hours: number;
  bonus: number;
  subs: number;
  furlough_hours: number;
  comments: string;
};

type WageRow = {
  employee: Employee;
  basic: number;
  sick: number;
  holiday: number;
  x15: number;
  x20: number;
  otProjects: string;
  furlough: number;
  travel: number;
  bonus: number;
  subs: number;
  comments: string;
};

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export default function WagePrepPage() {
  const { user, loading: authLoading } = useAuth();
  const [monday, setMonday] = useState(() => getMonday(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [timesheetData, setTimesheetData] = useState<TimesheetHours[]>([]);
  const [manualEntries, setManualEntries] = useState<Map<string, WagePrepEntry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [approvedSet, setApprovedSet] = useState<Set<string>>(new Set());

  // OT thresholds (configurable)
  const [basicThreshold, setBasicThreshold] = useState(40);
  const [satX15Limit, setSatX15Limit] = useState(5);
  const [showSettings, setShowSettings] = useState(false);

  const weekISO = toISO(monday);
  const weekNumber = getISOWeekNumber(monday);
  const weekDates = useMemo(() => getWeekDates(monday), [monday]);
  const weekEnd = toISO(weekDates[6]);

  const prevWeek = () => setMonday((m) => { const d = new Date(m); d.setDate(d.getDate() - 7); return d; });
  const nextWeek = () => setMonday((m) => { const d = new Date(m); d.setDate(d.getDate() + 7); return d; });

  // Load data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      const [empRes, tsRes, wpRes, apprRes] = await Promise.all([
        supabase.from("employees").select("id, first_name, last_name, payroll_id, team, active").eq("active", true).order("last_name").order("first_name"),
        supabase.from("timesheet_entries").select("employee_id, work_date, hours, project_item, is_overtime").gte("work_date", weekISO).lte("work_date", weekEnd),
        supabase.from("acc_wage_prep").select("*").eq("week_start", weekISO),
        supabase.from("timesheet_approvals").select("employee_id").eq("week_start", weekISO),
      ]);

      if (cancelled) return;

      setEmployees(empRes.data ?? []);
      setTimesheetData(tsRes.data ?? []);
      setApprovedSet(new Set((apprRes.data ?? []).map((a) => a.employee_id)));

      const wpMap = new Map<string, WagePrepEntry>();
      for (const wp of wpRes.data ?? []) {
        wpMap.set(wp.employee_id, wp);
      }
      setManualEntries(wpMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [weekISO, weekEnd]);

  // Calculate wage rows
  const wageRows = useMemo<WageRow[]>(() => {
    return employees.filter((e) => e.team === "shop").map((emp) => {
      const empEntries = timesheetData.filter((t) => t.employee_id === emp.id);

      // Split hours by day of week and type
      let monFriHours = 0;
      let saturdayHours = 0;
      let sundayHours = 0;
      let holidayHours = 0;
      let sickHours = 0;
      const projectHoursMap = new Map<string, number>();

      for (const e of empEntries) {
        const hrs = Number(e.hours);
        if (e.project_item === "HOLIDAY-01") {
          holidayHours += hrs;
          continue;
        }
        if (e.project_item === "SICK-01") {
          sickHours += hrs;
          continue;
        }
        // Training and all other items count towards basic hours

        const dayOfWeek = new Date(e.work_date + "T00:00:00").getDay(); // 0=Sun, 1=Mon...6=Sat
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          monFriHours += hrs;
        } else if (dayOfWeek === 6) {
          saturdayHours += hrs;
        } else if (dayOfWeek === 0) {
          sundayHours += hrs;
        }
        projectHoursMap.set(e.project_item, (projectHoursMap.get(e.project_item) ?? 0) + hrs);
      }

      // OT rules:
      // 1. Basic = first 40h cumulative Mon-Fri
      // 2. Once 40h hit: remaining Mon-Fri hours = 1.5x
      // 3. If threshold met: Sat first satX15Limit (5h) = 1.5x, Sat beyond = 2.0x
      // 4. Sunday: all hours at 2.0x (if threshold met)
      // 5. If threshold NOT met: no OT, Sat/Sun fill basic
      let basic: number;
      let x15 = 0;
      let x20 = 0;

      const monFriOT = Math.max(monFriHours - basicThreshold, 0);
      if (monFriHours >= basicThreshold) {
        // Threshold met — OT applies
        basic = basicThreshold;
        const satX15 = Math.min(saturdayHours, satX15Limit);
        const satX20 = Math.max(saturdayHours - satX15Limit, 0);
        x15 = monFriOT + satX15;
        x20 = satX20 + sundayHours;
      } else {
        // Threshold not met — Fri/Sat/Sun fill basic, no OT
        basic = Math.min(monFriHours + saturdayHours + sundayHours, basicThreshold);
      }

      // OT project breakdown from flagged entries, split by rate
      const otProjectRateMap = new Map<string, { x15: number; x20: number }>();
      for (const e of empEntries) {
        if (e.is_overtime && e.project_item !== "HOLIDAY-01" && e.project_item !== "SICK-01" && e.project_item !== "TRAINING-01") {
          const hrs = Number(e.hours);
          const dayOfWeek = new Date(e.work_date + "T00:00:00").getDay();
          if (!otProjectRateMap.has(e.project_item)) otProjectRateMap.set(e.project_item, { x15: 0, x20: 0 });
          const entry = otProjectRateMap.get(e.project_item)!;

          if (dayOfWeek === 0) {
            // Sunday — all x2.0
            entry.x20 += hrs;
          } else if (dayOfWeek === 6) {
            // Saturday — tracked globally, attribute per-project proportionally later
            // For now, all Sat OT goes into x15 bucket; we'll fix the split below
            entry.x15 += hrs;
          } else {
            // Mon-Fri OT — all x1.5
            entry.x15 += hrs;
          }
        }
      }

      // Fix Saturday split: redistribute Sat hours across projects proportionally
      // Total sat x15 = satX15Limit (5h), rest is x2.0
      if (saturdayHours > satX15Limit && monFriHours >= basicThreshold) {
        // Gather all Sat OT hours per project
        const satProjectHours = new Map<string, number>();
        for (const e of empEntries) {
          if (e.is_overtime && !["HOLIDAY-01", "SICK-01", "TRAINING-01"].includes(e.project_item)) {
            const dayOfWeek = new Date(e.work_date + "T00:00:00").getDay();
            if (dayOfWeek === 6) {
              satProjectHours.set(e.project_item, (satProjectHours.get(e.project_item) ?? 0) + Number(e.hours));
            }
          }
        }
        // Proportionally split: first satX15Limit hours at x1.5, rest at x2.0
        let remaining15 = satX15Limit;
        for (const [proj, satHrs] of Array.from(satProjectHours.entries()).sort((a, b) => b[1] - a[1])) {
          const entry = otProjectRateMap.get(proj);
          if (!entry) continue;
          // Remove the sat hours we initially put in x15
          entry.x15 -= satHrs;
          // Allocate to x1.5 up to remaining limit
          const asX15 = Math.min(satHrs, remaining15);
          const asX20 = satHrs - asX15;
          entry.x15 += asX15;
          entry.x20 += asX20;
          remaining15 -= asX15;
        }
      }

      let otProjects = "";
      if (otProjectRateMap.size > 0) {
        const parts = Array.from(otProjectRateMap.entries())
          .sort((a, b) => (b[1].x15 + b[1].x20) - (a[1].x15 + a[1].x20))
          .map(([proj, rates]) => {
            const segments: string[] = [];
            if (rates.x15 > 0) segments.push(`${rates.x15}h @ 1.5x`);
            if (rates.x20 > 0) segments.push(`${rates.x20}h @ 2x`);
            return `${proj} (${segments.join(", ")})`;
          });
        otProjects = "OT: " + parts.join(", ");
      }

      const manual = manualEntries.get(emp.id);

      return {
        employee: emp,
        basic,
        sick: sickHours,
        holiday: holidayHours,
        x15,
        x20,
        otProjects,
        furlough: manual?.furlough_hours ?? 0,
        travel: manual?.travel_hours ?? 0,
        bonus: manual?.bonus ?? 0,
        subs: manual?.subs ?? 0,
        comments: manual?.comments ?? "",
      };
    });
  }, [employees, timesheetData, manualEntries, basicThreshold, satX15Limit]);

  // Save manual entry for an employee
  const saveManualEntry = useCallback(async (employeeId: string, field: string, value: number | string) => {
    const existing = manualEntries.get(employeeId) ?? {
      employee_id: employeeId,
      week_start: weekISO,
      travel_hours: 0,
      bonus: 0,
      subs: 0,
      furlough_hours: 0,
      comments: "",
    };

    const updated = { ...existing, [field]: value };
    setManualEntries((prev) => new Map(prev).set(employeeId, updated));

    await supabase.from("acc_wage_prep").upsert(
      {
        employee_id: employeeId,
        week_start: weekISO,
        travel_hours: updated.travel_hours,
        bonus: updated.bonus,
        subs: updated.subs,
        furlough_hours: updated.furlough_hours,
        comments: updated.comments,
      },
      { onConflict: "employee_id,week_start" }
    );
  }, [manualEntries, weekISO]);

  // Save payroll_id back to employees table
  const savePayrollId = useCallback(async (employeeId: string, payrollId: string) => {
    setEmployees((prev) =>
      prev.map((e) => (e.id === employeeId ? { ...e, payroll_id: payrollId || null } : e))
    );
    await supabase.from("employees").update({ payroll_id: payrollId || null }).eq("id", employeeId);
  }, []);

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Wage Preparation</h1>
        <p className="text-gray-600">Sign in to access wage preparation</p>
        <AuthButton redirectTo="/timesheets/wages/" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 max-w-full mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Hourly Sheet &amp; Wage Preparation</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const exportRows = wageRows.map((r) => ({
                name: `${r.employee.last_name}, ${r.employee.first_name}`,
                employeeId: r.employee.payroll_id ?? "",
                basic: r.basic,
                sick: r.sick,
                holiday: r.holiday,
                x15: r.x15,
                x20: r.x20,
                furlough: r.furlough,
                travel: r.travel,
                bonus: r.bonus,
                subs: r.subs,
                comments: r.comments,
                otProjects: r.otProjects,
              }));
              exportPDF({ rows: exportRows, weekISO, weekNumber, weekLabel: formatWeekRange(monday) });
            }}
            disabled={wageRows.length === 0}
            className="rounded border px-3 py-1 text-sm cursor-pointer hover:bg-gray-100 disabled:opacity-50"
          >
            PDF
          </button>
          <button
            type="button"
            onClick={() => {
              const exportRows = wageRows.map((r) => ({
                name: `${r.employee.last_name}, ${r.employee.first_name}`,
                employeeId: r.employee.payroll_id ?? "",
                basic: r.basic,
                sick: r.sick,
                holiday: r.holiday,
                x15: r.x15,
                x20: r.x20,
                furlough: r.furlough,
                travel: r.travel,
                bonus: r.bonus,
                subs: r.subs,
                comments: r.comments,
                otProjects: r.otProjects,
              }));
              exportXLSX({ rows: exportRows, weekISO, weekNumber, weekLabel: formatWeekRange(monday) });
            }}
            disabled={wageRows.length === 0}
            className="rounded border px-3 py-1 text-sm cursor-pointer hover:bg-gray-100 disabled:opacity-50"
          >
            Excel
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="rounded border px-3 py-1 text-sm cursor-pointer hover:bg-gray-100"
          >
            Settings
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="border rounded bg-gray-50 p-4 mb-4 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Basic hours threshold:</label>
            <input
              type="number"
              value={basicThreshold}
              onChange={(e) => setBasicThreshold(Number(e.target.value) || 40)}
              className="w-16 rounded border px-2 py-1 text-sm text-center"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Sat x1.5 limit:</label>
            <input
              type="number"
              value={satX15Limit}
              onChange={(e) => setSatX15Limit(Number(e.target.value) || 5)}
              className="w-16 rounded border px-2 py-1 text-sm text-center"
            />
          </div>
          <div className="text-xs text-gray-500">
            Mon–Fri up to {basicThreshold}h = basic. If met: excess = x1.5, Sat first {satX15Limit}h = x1.5, Sat beyond = x2.0, Sun = x2.0
          </div>
        </div>
      )}

      {/* Week navigation */}
      <div className="flex items-center gap-4 mb-4">
        <button type="button" onClick={prevWeek} className="rounded border px-3 py-1 text-sm cursor-pointer hover:bg-gray-100">
          ← Prev
        </button>
        <div className="text-sm font-medium">
          <span className="font-semibold">Week {weekNumber}</span>
          <span className="text-gray-500 ml-2">{formatWeekRange(monday)}</span>
          <span className="text-gray-400 ml-2">({weekISO})</span>
        </div>
        <button type="button" onClick={nextWeek} className="rounded border px-3 py-1 text-sm cursor-pointer hover:bg-gray-100">
          Next →
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-4">Loading wage data...</div>
      ) : wageRows.length === 0 ? (
        <div className="text-gray-500 py-8 text-center border rounded">
          No shop employees found for this week
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="border px-1 py-2 text-center text-xs w-14">Status</th>
                <th className="border px-3 py-2 text-left min-w-40">Name</th>
                <th className="border px-2 py-2 text-center min-w-20">Team</th>
                <th className="border px-2 py-2 text-center min-w-24">Employee ID</th>
                <th className="border px-2 py-2 text-center min-w-16">Basic</th>
                <th className="border px-2 py-2 text-center min-w-16">Sick</th>
                <th className="border px-2 py-2 text-center min-w-16">Holiday</th>
                <th className="border px-2 py-2 text-center min-w-16">x1.5</th>
                <th className="border px-2 py-2 text-center min-w-16">x2.0</th>
                <th className="border px-2 py-2 text-center min-w-16">Furlough</th>
                <th className="border px-2 py-2 text-center min-w-16">Travel</th>
                <th className="border px-2 py-2 text-center min-w-20">Bonus (£)</th>
                <th className="border px-2 py-2 text-center min-w-20">Subs (£)</th>
                <th className="border px-3 py-2 text-left min-w-48">Comments</th>
              </tr>
            </thead>
            <tbody>
              {wageRows.map((row) => (
                <tr key={row.employee.id} className="hover:bg-gray-50">
                  <td className="border px-1 py-1.5 text-center">
                    {approvedSet.has(row.employee.id) ? (
                      <span className="inline-block w-3 h-3 rounded-full bg-green-500" title="Timesheet approved" />
                    ) : (
                      <span className="inline-block w-3 h-3 rounded-full bg-red-400" title="Timesheet not approved" />
                    )}
                  </td>
                  <td className="border px-3 py-1.5 font-medium">
                    <Link
                      href={`/?employee=${row.employee.id}&week=${weekISO}`}
                      className="text-blue-600 hover:underline"
                    >
                      {row.employee.last_name}, {row.employee.first_name}
                    </Link>
                  </td>
                  <td className="border px-2 py-1.5 text-center text-xs">
                    <span className={`px-1.5 py-0.5 rounded ${row.employee.team === "shop" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                      {row.employee.team}
                    </span>
                  </td>
                  <td className="border px-0 py-0">
                    <input
                      type="text"
                      defaultValue={row.employee.payroll_id ?? ""}
                      onBlur={(e) => savePayrollId(row.employee.id, e.target.value)}
                      className="w-full px-2 py-1.5 text-center text-sm border-0 outline-none focus:bg-blue-50"
                      placeholder="—"
                    />
                  </td>
                  <td className="border px-3 py-1.5 text-right font-medium">{row.basic > 0 ? row.basic.toFixed(2) : "–"}</td>
                  <td className="border px-3 py-1.5 text-right font-medium text-black"><span className="text-red-600">{row.sick > 0 ? row.sick.toFixed(2) : "–"}</span></td>
                  <td className="border px-3 py-1.5 text-right">{row.holiday > 0 ? row.holiday.toFixed(2) : "–"}</td>
                  <td className="border px-3 py-1.5 text-right">{row.x15 > 0 ? <span className="text-amber-600 font-medium">{row.x15.toFixed(2)}</span> : "–"}</td>
                  <td className="border px-3 py-1.5 text-right">{row.x20 > 0 ? <span className="text-red-600 font-medium">{row.x20.toFixed(2)}</span> : "–"}</td>
                  <td className="border px-0 py-0">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      defaultValue={row.furlough ? row.furlough.toFixed(2) : ""}
                      onBlur={(e) => saveManualEntry(row.employee.id, "furlough_hours", parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-1.5 text-right text-sm border-0 outline-none focus:bg-blue-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="–"
                    />
                  </td>
                  <td className="border px-0 py-0">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      defaultValue={row.travel ? row.travel.toFixed(2) : ""}
                      onBlur={(e) => saveManualEntry(row.employee.id, "travel_hours", parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-1.5 text-right text-sm border-0 outline-none focus:bg-blue-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="–"
                    />
                  </td>
                  <td className="border px-0 py-0">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={row.bonus ? row.bonus.toFixed(2) : ""}
                      onBlur={(e) => saveManualEntry(row.employee.id, "bonus", parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-1.5 text-right text-sm border-0 outline-none focus:bg-blue-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="–"
                    />
                  </td>
                  <td className="border px-0 py-0">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={row.subs ? row.subs.toFixed(2) : ""}
                      onBlur={(e) => saveManualEntry(row.employee.id, "subs", parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-1.5 text-right text-sm border-0 outline-none focus:bg-blue-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="–"
                    />
                  </td>
                  <td className="border px-3 py-1">
                    {row.otProjects && (
                      <div className="text-xs text-amber-600 mb-1">{row.otProjects}</div>
                    )}
                    <input
                      type="text"
                      defaultValue={row.comments}
                      onBlur={(e) => saveManualEntry(row.employee.id, "comments", e.target.value)}
                      className="w-full px-0 py-0.5 text-sm border-0 outline-none focus:bg-blue-50"
                      placeholder="—"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
