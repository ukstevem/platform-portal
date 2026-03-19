"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { EmployeePicker } from "@/components/EmployeePicker";
import { EmployeeStatusPanel } from "@/components/EmployeeStatusPanel";
import { WeekNav } from "@/components/WeekNav";
import { TimesheetGrid } from "@/components/TimesheetGrid";
import { getMonday } from "@/lib/weekHelpers";
import type { Employee } from "@/lib/types";

export default function TimesheetsPage() {
  const { user, loading } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [monday, setMonday] = useState(() => getMonday(new Date()));
  const [refreshKey, setRefreshKey] = useState(0);
  const onApprovalChange = () => setRefreshKey((k) => k + 1);

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
          <WeekNav monday={monday} onPrev={prevWeek} onNext={nextWeek} />
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
