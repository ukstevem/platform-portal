"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { getMonday, toISO } from "@/lib/weekHelpers";

function formatDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

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

function varianceCellClass(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs <= 30) return "";
  if (abs <= 60) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
};

type DeviationRow = {
  id: string;
  employee_id: string;
  week_start: string;
  approved_at: string;
  clocked_minutes: number;
  allocated_work_minutes: number;
  variance_minutes: number;
  incomplete_clocking: boolean;
};

export default function VariancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <VariancePageInner />
    </Suspense>
  );
}

function VariancePageInner() {
  const { user, loading: authLoading } = useAuth();

  const [weeksBack, setWeeksBack] = useState(8);
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [minVarianceMin, setMinVarianceMin] = useState(30);
  const [excludeIncomplete, setExcludeIncomplete] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<DeviationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    const currentMonday = getMonday(now);
    const start = new Date(currentMonday);
    start.setDate(start.getDate() - (weeksBack - 1) * 7);
    return { rangeStart: toISO(start), rangeEnd: toISO(now) };
  }, [weeksBack]);

  // Load employees for the picker + name lookup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .order("last_name")
        .order("first_name");
      if (!cancelled) setEmployees(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load approval snapshots in the active window. Excludes legacy
  // approvals (variance_minutes IS NULL).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("timesheet_approvals")
        .select(
          "id, employee_id, week_start, approved_at, clocked_minutes, allocated_work_minutes, variance_minutes, incomplete_clocking"
        )
        .gte("week_start", rangeStart)
        .lte("week_start", rangeEnd)
        .not("variance_minutes", "is", null);
      if (employeeFilter !== "all") q = q.eq("employee_id", employeeFilter);
      const { data } = await q;
      if (cancelled) return;
      setRows((data ?? []) as DeviationRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeStart, rangeEnd, employeeFilter]);

  const empMap = useMemo(
    () =>
      new Map(
        employees.map((e) => [e.id, `${e.last_name}, ${e.first_name}`] as const)
      ),
    [employees]
  );

  // Apply the client-side filters and sort.
  const visibleRows = useMemo(() => {
    let filtered = rows.filter(
      (r) => Math.abs(r.variance_minutes) >= minVarianceMin
    );
    if (excludeIncomplete) {
      filtered = filtered.filter((r) => !r.incomplete_clocking);
    }
    return filtered.sort((a, b) => {
      const wk = b.week_start.localeCompare(a.week_start);
      if (wk !== 0) return wk;
      return Math.abs(b.variance_minutes) - Math.abs(a.variance_minutes);
    });
  }, [rows, minVarianceMin, excludeIncomplete]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Variance Deviations</h1>
        <p className="text-gray-600">Sign in to view variance reports</p>
        <AuthButton redirectTo="/timesheets/reports/variance/" />
      </div>
    );
  }

  const hiddenByFilters = rows.length - visibleRows.length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">Variance Deviations</h1>
      <p className="text-sm text-gray-500 mb-6">
        Cross-check between allocated project hours (timesheets) and clocked
        hours (presence). Snapshotted at the moment of approval.
      </p>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Last:</label>
          {[4, 8, 12, 26].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeeksBack(w)}
              className={`rounded border px-3 py-1 text-sm cursor-pointer ${
                weeksBack === w
                  ? "bg-blue-600 text-white border-blue-600"
                  : "hover:bg-gray-100"
              }`}
            >
              {w}w
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Employee:</label>
          <select
            className="rounded border px-2 py-1 text-sm bg-white cursor-pointer"
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
          >
            <option value="all">All</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.last_name}, {e.first_name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Min |Δ|:</label>
          {[0, 30, 60, 120].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMinVarianceMin(m)}
              className={`rounded border px-3 py-1 text-sm cursor-pointer ${
                minVarianceMin === m
                  ? "bg-blue-600 text-white border-blue-600"
                  : "hover:bg-gray-100"
              }`}
            >
              {m === 0 ? "any" : m < 60 ? `${m}min` : `${m / 60}h`}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={excludeIncomplete}
            onChange={(e) => setExcludeIncomplete(e.target.checked)}
            className="cursor-pointer"
          />
          Exclude incomplete clocking
        </label>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-4">Loading...</div>
      ) : visibleRows.length === 0 ? (
        <div className="text-gray-500 py-8 text-center border rounded">
          No deviations found in this period
          {hiddenByFilters > 0 && ` (${hiddenByFilters} hidden by filters)`}
        </div>
      ) : (
        <div className="overflow-x-auto border rounded bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="border-b px-4 py-2 text-left">Employee</th>
                <th className="border-b px-3 py-2 text-left whitespace-nowrap">
                  Week starting
                </th>
                <th className="border-b px-3 py-2 text-right">Clocked</th>
                <th className="border-b px-3 py-2 text-right">Allocated</th>
                <th className="border-b px-3 py-2 text-right">Variance</th>
                <th className="border-b px-3 py-2 text-center">Status</th>
                <th className="border-b px-3 py-2 text-left whitespace-nowrap">
                  Approved
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="border-b px-4 py-1.5">
                    <Link
                      href={`/timesheets/?employee=${r.employee_id}&week=${r.week_start}`}
                      className="text-blue-600 hover:underline"
                    >
                      {empMap.get(r.employee_id) ?? r.employee_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="border-b px-3 py-1.5 whitespace-nowrap">
                    {new Date(r.week_start + "T00:00:00").toLocaleDateString(
                      "en-GB",
                      { day: "numeric", month: "short", year: "numeric" }
                    )}
                  </td>
                  <td className="border-b px-3 py-1.5 text-right">
                    {formatDecimalHours(r.clocked_minutes)}h
                  </td>
                  <td className="border-b px-3 py-1.5 text-right">
                    {formatDecimalHours(r.allocated_work_minutes)}h
                  </td>
                  <td
                    className={`border-b px-3 py-1.5 text-right font-medium ${varianceCellClass(r.variance_minutes)}`}
                    title={`Clocked ${formatHM(r.clocked_minutes)}, Allocated ${formatHM(r.allocated_work_minutes)}, Variance ${formatHM(r.variance_minutes, true)}`}
                  >
                    {formatSignedDecimalHours(r.variance_minutes)}h
                  </td>
                  <td className="border-b px-3 py-1.5 text-center">
                    {r.incomplete_clocking && (
                      <span
                        className="text-amber-600 text-xs"
                        title="At least one day in this week had a missed clock-in or clock-out at the moment of approval"
                      >
                        ⚠ incomplete
                      </span>
                    )}
                  </td>
                  <td className="border-b px-3 py-1.5 whitespace-nowrap text-xs text-gray-500">
                    {new Date(r.approved_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        {visibleRows.length} {visibleRows.length === 1 ? "row" : "rows"} shown
        {hiddenByFilters > 0 && ` • ${hiddenByFilters} hidden by filters`}
        {" • "}Sort: most recent week first, largest |variance| within week.
      </p>
    </div>
  );
}
