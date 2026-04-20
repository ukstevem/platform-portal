"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { EmployeePicker } from "@/components/EmployeePicker";
import { EmployeeStatusPanel } from "@/components/EmployeeStatusPanel";
import { WeekNav } from "@/components/WeekNav";
import { TimesheetGrid } from "@/components/TimesheetGrid";
import { getMonday } from "@/lib/weekHelpers";
import type { Employee } from "@/lib/types";

export default function TimesheetsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p className="text-gray-500">Loading...</p></div>}>
      <TimesheetsPageInner />
    </Suspense>
  );
}

function TimesheetsPageInner() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [monday, setMonday] = useState(() => {
    const weekParam = searchParams.get("week");
    if (weekParam) return getMonday(new Date(weekParam + "T00:00:00"));
    return getMonday(new Date());
  });

  // Load employee from query param
  useEffect(() => {
    const empId = searchParams.get("employee");
    if (!empId) return;
    (async () => {
      const { data } = await supabase.from("employees").select("id, first_name, last_name, active").eq("id", empId).maybeSingle();
      if (data) setEmployee(data);
    })();
  }, [searchParams]);
  const [refreshKey, setRefreshKey] = useState(0);
  const onApprovalChange = () => setRefreshKey((k) => k + 1);

  const currentMonday = getMonday(new Date());
  const isCurrentOrFutureWeek = monday >= currentMonday;

  const prevWeek = () =>
    setMonday((m) => {
      const d = new Date(m);
      d.setDate(d.getDate() - 7);
      return d;
    });

  const nextWeek = () =>
    setMonday((m) => {
      const d = new Date(m);
      d.setDate(d.getDate() + 7);
      if (d > currentMonday) return m; // prevent navigating to future weeks
      return d;
    });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Timesheets</h1>
        <p className="text-gray-600">Sign in to manage timesheets</p>
        <AuthButton redirectTo="/timesheets/" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-semibold">Weekly Timesheet Entry</h1>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <EmployeePicker selected={employee} onSelect={setEmployee} />
        <div className="sm:ml-auto">
          <WeekNav monday={monday} onPrev={prevWeek} onNext={nextWeek} disableNext={isCurrentOrFutureWeek} />
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left: employee status panel */}
        <div className="w-72 shrink-0">
          <EmployeeStatusPanel
            monday={monday}
            selectedId={employee?.id ?? null}
            onSelect={setEmployee}
            refreshKey={refreshKey}
          />
        </div>

        {/* Right: timesheet grid */}
        <div className="flex-1 min-w-0">
          {employee ? (
            <TimesheetGrid
              key={`${employee.id}-${monday.toISOString()}`}
              employee={employee}
              monday={monday}
              onApprovalChange={onApprovalChange}
            />
          ) : (
            <div className="text-gray-500 py-8 text-center border rounded">
              Select an employee to view their timesheet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
