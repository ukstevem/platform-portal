"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { getWeekDates, toISO, DAY_LABELS } from "@/lib/weekHelpers";
import type { Employee, GridRow, ProjectItem } from "@/lib/types";

type Props = {
  employee: Employee;
  monday: Date;
  onApprovalChange?: () => void;
};

const PERSISTENT_ITEMS = [
  { project_item: "SHOPWORK-01", line_desc: "Shop Work" },
  { project_item: "HOLIDAY-01", line_desc: "Holiday" },
  { project_item: "TRAINING-01", line_desc: "Training" },
  { project_item: "SICK-01", line_desc: "Sick" },
];

export function TimesheetGrid({ employee, monday, onApprovalChange }: Props) {
  const { user } = useAuth();
  const weekDates = useMemo(() => getWeekDates(monday), [monday]);
  const weekISOs = useMemo(() => weekDates.map(toISO), [weekDates]);

  const [rows, setRows] = useState<GridRow[]>([]);
  const [projectItems, setProjectItems] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const savingRef = useRef<Set<string>>(new Set());
  const [approval, setApproval] = useState<{ approved_by: string; approved_at: string } | null>(null);
  const [approving, setApproving] = useState(false);

  // Load project items for the add-project picker
  useEffect(() => {
    (async () => {
      let all: { projectnumber: string; item_seq: number; line_desc: string }[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data } = await supabase
          .from("project_register_items")
          .select("projectnumber, item_seq, line_desc")
          .order("projectnumber")
          .order("item_seq")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setProjectItems(
        all.map((r) => ({
          project_item: `${r.projectnumber}-${String(r.item_seq).padStart(2, "0")}`,
          line_desc: r.line_desc,
        }))
      );
    })();
  }, []);

  // Build a lookup for line_desc display
  const descMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of PERSISTENT_ITEMS) {
      m.set(p.project_item, p.line_desc);
    }
    for (const p of projectItems) {
      m.set(p.project_item, p.line_desc);
    }
    return m;
  }, [projectItems]);

  // Load timesheet entries + prepopulate from previous week
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data: entries } = await supabase
        .from("timesheet_entries")
        .select("project_item, work_date, hours, is_overtime")
        .eq("employee_id", employee.id)
        .gte("work_date", weekISOs[0])
        .lte("work_date", weekISOs[6]);

      if (cancelled) return;

      const rowMap = new Map<string, Record<string, number>>();
      const otMap = new Map<string, Record<string, boolean>>();
      for (const e of entries ?? []) {
        if (!rowMap.has(e.project_item)) {
          rowMap.set(e.project_item, {});
          otMap.set(e.project_item, {});
        }
        rowMap.get(e.project_item)![e.work_date] = Number(e.hours);
        otMap.get(e.project_item)![e.work_date] = !!e.is_overtime;
      }

      // If no rows this week, prepopulate project list from previous week
      if (rowMap.size === 0) {
        const prevMonday = new Date(monday);
        prevMonday.setDate(prevMonday.getDate() - 7);
        const prevSunday = new Date(prevMonday);
        prevSunday.setDate(prevMonday.getDate() + 6);

        const { data: prevEntries } = await supabase
          .from("timesheet_entries")
          .select("project_item")
          .eq("employee_id", employee.id)
          .gte("work_date", toISO(prevMonday))
          .lte("work_date", toISO(prevSunday));

        if (cancelled) return;

        const seen = new Set<string>();
        for (const e of prevEntries ?? []) {
          if (!seen.has(e.project_item)) {
            seen.add(e.project_item);
            rowMap.set(e.project_item, {});
          }
        }
      }

      // Ensure persistent items are always present
      for (const p of PERSISTENT_ITEMS) {
        if (!rowMap.has(p.project_item)) {
          rowMap.set(p.project_item, {});
        }
      }

      const persistentKeys = new Set(PERSISTENT_ITEMS.map((p) => p.project_item));
      const projectRows: GridRow[] = [];
      const persistentRows: GridRow[] = [];
      for (const [project_item, hours] of rowMap) {
        const overtime = otMap.get(project_item) ?? {};
        if (persistentKeys.has(project_item)) {
          persistentRows.push({ project_item, hours, overtime });
        } else {
          projectRows.push({ project_item, hours, overtime });
        }
      }
      const gridRows: GridRow[] = [...projectRows, ...persistentRows];

      // Load approval status
      const { data: approvalData } = await supabase
        .from("timesheet_approvals")
        .select("approved_by, approved_at")
        .eq("employee_id", employee.id)
        .eq("week_start", weekISOs[0])
        .maybeSingle();

      if (cancelled) return;

      if (!cancelled) {
        setRows(gridRows);
        setApproval(approvalData ?? null);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employee.id, monday, weekISOs]);

  const saveCell = useCallback(
    async (project_item: string, dateISO: string, hours: number) => {
      const key = `${project_item}:${dateISO}`;
      if (savingRef.current.has(key)) return;
      savingRef.current.add(key);

      if (hours === 0) {
        await supabase
          .from("timesheet_entries")
          .delete()
          .eq("employee_id", employee.id)
          .eq("project_item", project_item)
          .eq("work_date", dateISO);
      } else {
        await supabase.from("timesheet_entries").upsert(
          {
            employee_id: employee.id,
            project_item,
            work_date: dateISO,
            hours,
            entered_by: user?.id ?? null,
          },
          { onConflict: "employee_id,project_item,work_date" }
        );
      }

      savingRef.current.delete(key);
    },
    [employee.id, user?.id]
  );

  // Auto-flag Sat/Sun as OT when Mon-Fri >= 40h
  const autoFlagWeekendOT = useCallback(() => {
    const monFriISOs = weekISOs.slice(0, 5);
    const weekendISOs = weekISOs.slice(5); // Sat, Sun

    const nonWork = new Set(["SICK-01"]);
    const monFriTotal = monFriISOs.reduce((sum, iso) =>
      sum + rows.reduce((s, row) => {
        if (nonWork.has(row.project_item)) return s;
        return s + (row.hours[iso] ?? 0);
      }, 0), 0
    );
    const shouldBeOT = monFriTotal >= 40;

    let changed = false;
    const updated = rows.map((row) => {
      let rowChanged = false;
      const newOT = { ...row.overtime };
      for (const iso of weekendISOs) {
        const hasHours = (row.hours[iso] ?? 0) > 0;
        if (hasHours && newOT[iso] !== shouldBeOT) {
          newOT[iso] = shouldBeOT;
          rowChanged = true;
          // Save to DB
          supabase
            .from("timesheet_entries")
            .update({ is_overtime: shouldBeOT })
            .eq("employee_id", employee.id)
            .eq("project_item", row.project_item)
            .eq("work_date", iso)
            .then(() => {});
        }
      }
      if (rowChanged) { changed = true; return { ...row, overtime: newOT }; }
      return row;
    });

    if (changed) setRows(updated);
  }, [rows, weekISOs, employee.id]);

  // Run auto-flag after any hours change settles
  useEffect(() => {
    autoFlagWeekendOT();
  }, [rows.map(r => weekISOs.map(iso => r.hours[iso] ?? 0).join(",")).join("|")]);

  const handleHoursChange = (
    rowIdx: number,
    dateISO: string,
    value: string
  ) => {
    const num = value === "" ? 0 : parseFloat(value);
    if (isNaN(num) || num < 0 || num > 24) return;

    setRows((prev) => {
      const updated = [...prev];
      updated[rowIdx] = {
        ...updated[rowIdx],
        hours: { ...updated[rowIdx].hours, [dateISO]: num },
      };
      return updated;
    });
  };

  const handleBlur = (rowIdx: number, dateISO: string) => {
    const row = rows[rowIdx];
    const hours = row.hours[dateISO] ?? 0;
    saveCell(row.project_item, dateISO, hours);
  };

  const toggleOvertime = (rowIdx: number, dateISO: string) => {
    const row = rows[rowIdx];
    const hours = row.hours[dateISO] ?? 0;
    if (hours === 0) return; // Can't flag empty cells

    const newOT = !row.overtime[dateISO];
    setRows((prev) => {
      const updated = [...prev];
      updated[rowIdx] = {
        ...updated[rowIdx],
        overtime: { ...updated[rowIdx].overtime, [dateISO]: newOT },
      };
      return updated;
    });

    // Save to Supabase
    supabase
      .from("timesheet_entries")
      .update({ is_overtime: newOT })
      .eq("employee_id", employee.id)
      .eq("project_item", row.project_item)
      .eq("work_date", dateISO)
      .then(() => {});
  };

  const sortRows = (input: GridRow[]): GridRow[] => {
    const persistentKeys = new Set(PERSISTENT_ITEMS.map((p) => p.project_item));
    const projectRows = input.filter((r) => !persistentKeys.has(r.project_item));
    const persistentRows = input.filter((r) => persistentKeys.has(r.project_item));
    projectRows.sort((a, b) => a.project_item.localeCompare(b.project_item));
    return [...projectRows, ...persistentRows];
  };

  const addProject = (project_item: string) => {
    if (rows.some((r) => r.project_item === project_item)) return;
    setRows((prev) => sortRows([...prev, { project_item, hours: {}, overtime: {} }]));
    setShowProjectPicker(false);
    setProjectSearch("");
  };

  const isPersistent = (project_item: string) =>
    PERSISTENT_ITEMS.some((p) => p.project_item === project_item);

  const removeRow = (rowIdx: number) => {
    const row = rows[rowIdx];
    if (isPersistent(row.project_item)) return;
    for (const dateISO of weekISOs) {
      if (row.hours[dateISO] && row.hours[dateISO] > 0) {
        supabase
          .from("timesheet_entries")
          .delete()
          .eq("employee_id", employee.id)
          .eq("project_item", row.project_item)
          .eq("work_date", dateISO)
          .then(() => {});
      }
    }
    setRows((prev) => prev.filter((_, i) => i !== rowIdx));
  };

  // Calculate totals + overtime
  // Basic = first 40h cumulative across Mon-Fri (excluding sick & holiday)
  // Once 40h hit: remaining hours that day + subsequent days = OT
  // Saturday: always OT if threshold met (first 5h x1.5, beyond x2.0)
  const OT_HURDLE = 40;
  const NON_WORK_ITEMS = new Set(["SICK-01"]);

  // Full day totals (all items, for display)
  const dayTotals = weekISOs.map((iso) =>
    rows.reduce((sum, row) => sum + (row.hours[iso] ?? 0), 0)
  );
  const grandTotal = dayTotals.reduce((a, b) => a + b, 0);

  // Working day totals (excluding sick & holiday, for OT threshold)
  const dayWorkTotals = weekISOs.map((iso) =>
    rows.reduce((sum, row) => {
      if (NON_WORK_ITEMS.has(row.project_item)) return sum;
      return sum + (row.hours[iso] ?? 0);
    }, 0)
  );

  // Mon-Fri working hours (excludes sick/holiday)
  const monFriWorkTotal = dayWorkTotals.slice(0, 5).reduce((a, b) => a + b, 0);
  const saturdayWorkTotal = dayWorkTotals[5] ?? 0;
  const thresholdMet = monFriWorkTotal >= OT_HURDLE;

  const { dayStraight, dayOvertime } = (() => {
    const st: number[] = [];
    const ot: number[] = [];

    // Mon-Fri (indices 0-4): cumulative working hours, basic until 40h, then OT
    let running = 0;
    for (let i = 0; i < 5; i++) {
      const dt = dayWorkTotals[i];
      const prev = running;
      running += dt;
      if (prev >= OT_HURDLE) {
        st.push(0); ot.push(dt);
      } else if (running > OT_HURDLE) {
        st.push(OT_HURDLE - prev); ot.push(running - OT_HURDLE);
      } else {
        st.push(dt); ot.push(0);
      }
    }

    // Saturday (index 5): all OT if threshold met, otherwise basic
    if (thresholdMet) {
      st.push(0); ot.push(saturdayWorkTotal);
    } else {
      st.push(saturdayWorkTotal); ot.push(0);
    }

    // Sunday (index 6)
    const sunWorkTotal = dayWorkTotals[6] ?? 0;
    if (thresholdMet) {
      st.push(0); ot.push(sunWorkTotal);
    } else {
      st.push(sunWorkTotal); ot.push(0);
    }

    return { dayStraight: st, dayOvertime: ot };
  })();

  const straightTime = dayStraight.reduce((a, b) => a + b, 0);
  const overtime = dayOvertime.reduce((a, b) => a + b, 0);

  // Check if OT exists but not all OT hours are flagged on entries
  const totalFlaggedOT = rows.reduce((sum, row) => {
    return sum + weekISOs.reduce((s, iso) => s + (row.overtime[iso] && (row.hours[iso] ?? 0) > 0 ? (row.hours[iso] ?? 0) : 0), 0);
  }, 0);
  const otNeedsFlagging = thresholdMet && overtime > 0 && totalFlaggedOT < overtime;

  const handleApprove = async () => {
    if (!user) return;
    setApproving(true);
    const { error } = await supabase.from("timesheet_approvals").upsert(
      {
        employee_id: employee.id,
        week_start: weekISOs[0],
        approved_by: user.id,
      },
      { onConflict: "employee_id,week_start" }
    );
    if (!error) {
      setApproval({ approved_by: user.id, approved_at: new Date().toISOString() });
      onApprovalChange?.();
    }
    setApproving(false);
  };

  const handleUnapprove = async () => {
    setApproving(true);
    await supabase
      .from("timesheet_approvals")
      .delete()
      .eq("employee_id", employee.id)
      .eq("week_start", weekISOs[0]);
    setApproval(null);
    onApprovalChange?.();
    setApproving(false);
  };

  const searchLower = projectSearch.toLowerCase();
  const filteredProjects = projectItems.filter(
    (p) =>
      !rows.some((r) => r.project_item === p.project_item) &&
      (p.project_item.toLowerCase().includes(searchLower) ||
        p.line_desc.toLowerCase().includes(searchLower))
  );

  if (loading) {
    return <div className="text-sm text-gray-500 py-4">Loading timesheet...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Add project — separate panel above the table */}
      <div className="border rounded bg-gray-50 px-4 py-3">
        {!showProjectPicker ? (
          <button
            type="button"
            onClick={() => setShowProjectPicker(true)}
            className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-100 cursor-pointer"
          >
            + Add project row
          </button>
        ) : (
          <div className="flex items-start gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Search project number or description..."
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                className="rounded border px-3 py-1.5 text-sm w-96 bg-white"
                autoFocus
              />
              {filteredProjects.length > 0 && projectSearch.length > 0 && (
                <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg max-h-72 overflow-y-auto w-96 z-20">
                  {filteredProjects.length > 50 && (
                    <div className="px-3 py-1.5 text-xs text-gray-400 border-b">
                      Showing 50 of {filteredProjects.length} — type more to narrow
                    </div>
                  )}
                  {filteredProjects.slice(0, 50).map((p) => (
                    <button
                      key={p.project_item}
                      type="button"
                      onClick={() => addProject(p.project_item)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 cursor-pointer"
                    >
                      <span className="font-mono font-medium">{p.project_item}</span>
                      <span className="text-gray-500 ml-2 text-xs">{p.line_desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowProjectPicker(false);
                setProjectSearch("");
              }}
              className="rounded border bg-white px-2 py-1.5 text-sm hover:bg-gray-100 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Approval status */}
      <div className="border rounded px-4 py-3 flex items-center justify-between bg-white">
        {approval ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Approved
            </span>
            <span className="text-xs text-gray-500">
              {new Date(approval.approved_at).toLocaleDateString("en-GB", {
                day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </span>
            <button
              type="button"
              onClick={handleUnapprove}
              disabled={approving}
              className="text-xs text-red-500 hover:text-red-700 underline cursor-pointer disabled:opacity-50"
            >
              Remove approval
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">Not yet approved</span>
            {otNeedsFlagging && (
              <span className="text-xs text-amber-600 font-medium">
                — Define O/T job(s): {overtime}h overtime, {totalFlaggedOT}h flagged
              </span>
            )}
          </div>
        )}
        {!approval && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={approving || grandTotal === 0 || otNeedsFlagging}
            className="rounded bg-green-600 px-4 py-1.5 text-sm text-white font-medium hover:bg-green-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {approving ? "Approving..." : "Approve Timesheet"}
          </button>
        )}
      </div>

      {/* Timesheet grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="border px-3 py-2 text-left min-w-52">Project</th>
              {weekDates.map((d, i) => (
                <th key={i} className="border px-2 py-2 text-center w-18">
                  <div>{DAY_LABELS[i]}</div>
                  <div className="text-xs text-gray-500 font-normal">
                    {d.getDate()}/{d.getMonth() + 1}
                  </div>
                </th>
              ))}
              <th className="border px-2 py-2 text-center w-16">Total</th>
              <th className="border px-1 py-2 w-9"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const rowTotal = weekISOs.reduce(
                (sum, iso) => sum + (row.hours[iso] ?? 0),
                0
              );
              const desc = descMap.get(row.project_item);
              return (
                <tr key={row.project_item} className="hover:bg-gray-50">
                  <td className="border px-3 py-1">
                    <div className="font-mono text-xs font-medium">{row.project_item}</div>
                    {desc && (
                      <div className="text-xs text-gray-500 truncate max-w-52">{desc}</div>
                    )}
                  </td>
                  {weekISOs.map((iso) => {
                    const isOT = row.overtime[iso];
                    const hasHours = (row.hours[iso] ?? 0) > 0;
                    return (
                      <td
                        key={iso}
                        className={`border px-0 py-0 relative group/cell ${isOT ? "bg-amber-100" : ""}`}
                      >
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          value={row.hours[iso] ?? ""}
                          onChange={(e) =>
                            handleHoursChange(rowIdx, iso, e.target.value)
                          }
                          onBlur={() => handleBlur(rowIdx, iso)}
                          className={`w-full h-full px-2 py-1.5 text-center text-sm border-0 outline-none focus:bg-blue-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${isOT ? "bg-amber-100 text-amber-800 font-medium" : ""}`}
                          placeholder="–"
                        />
                        {hasHours && (
                          <button
                            type="button"
                            onClick={() => toggleOvertime(rowIdx, iso)}
                            className={`absolute right-0 top-0 bottom-0 w-5 flex items-center justify-center text-[8px] font-bold cursor-pointer transition-opacity ${
                              isOT
                                ? "bg-amber-500 text-white opacity-100"
                                : "bg-gray-300 text-gray-600 opacity-0 group-hover/cell:opacity-100"
                            }`}
                            title={isOT ? "Remove overtime" : "Flag as overtime"}
                          >
                            OT
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="border px-2 py-1 text-center font-medium">
                    {rowTotal > 0 ? rowTotal : ""}
                  </td>
                  <td className="border px-1 py-1 text-center">
                    {!isPersistent(row.project_item) && (
                      <button
                        type="button"
                        onClick={() => removeRow(rowIdx)}
                        className="text-red-400 hover:text-red-600 cursor-pointer text-xs"
                        title="Remove project row"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Totals row */}
            <tr className="bg-gray-50 font-medium">
              <td className="border px-3 py-1.5 text-right">Daily totals</td>
              {dayTotals.map((total, i) => (
                <td key={i} className="border px-2 py-1.5 text-center">
                  {total > 0 ? total : ""}
                </td>
              ))}
              <td className="border px-2 py-1.5 text-center font-bold">
                {grandTotal > 0 ? grandTotal : ""}
              </td>
              <td className="border"></td>
            </tr>

            {/* Straight time row */}
            <tr className="bg-gray-50 text-xs">
              <td className="border px-3 py-1.5 text-right text-gray-600">
                Straight time (Mon–Fri ≤{OT_HURDLE}h)
              </td>
              {dayStraight.map((h, i) => (
                <td key={i} className="border px-2 py-1.5 text-center text-gray-600">
                  {h > 0 ? h : ""}
                </td>
              ))}
              <td className="border px-2 py-1.5 text-center font-medium text-gray-700">
                {straightTime > 0 ? straightTime : ""}
              </td>
              <td className="border"></td>
            </tr>

            {/* Overtime row */}
            <tr className={`text-xs ${overtime > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
              <td className={`border px-3 py-1.5 text-right ${overtime > 0 ? "text-amber-700 font-medium" : "text-gray-600"}`}>
                Overtime (Mon–Fri &gt;{OT_HURDLE}h + Sat/Sun)
              </td>
              {dayOvertime.map((h, i) => (
                <td key={i} className={`border px-2 py-1.5 text-center ${h > 0 ? "text-amber-700 font-medium" : ""}`}>
                  {h > 0 ? h : ""}
                </td>
              ))}
              <td className={`border px-2 py-1.5 text-center font-bold ${overtime > 0 ? "text-amber-700" : ""}`}>
                {overtime > 0 ? overtime : ""}
              </td>
              <td className="border"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
