"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { getMonday, toISO, formatWeekRange, getWeekDates, DAY_LABELS } from "@/lib/weekHelpers";
import { calculateBradford, BRADFORD_THRESHOLDS, type BradfordResult } from "@/lib/bradford";

type RawEntry = {
  project_item: string;
  work_date: string;
  hours: number;
  employee_id: string;
};

type WeekColumn = {
  mondayISO: string;
  label: string;
};

/** An item-level row */
type ItemRow = {
  project_item: string;
  weekHours: Record<string, number>;
  total: number;
};

/** A project-level group with aggregated totals and optional item breakdown */
type ProjectGroup = {
  projectnumber: string;
  weekHours: Record<string, number>;
  total: number;
  items: ItemRow[];
  hasMultipleItems: boolean;
};

type DrilldownSelection = {
  project_item: string;
  mondayISO: string;
} | null;

type DrilldownEntry = {
  employee_name: string;
  work_date: string;
  hours: number;
};

function Sparkline({ weekHours, weekColumns: cols }: { weekHours: Record<string, number>; weekColumns: WeekColumn[] }) {
  const values = cols.map((wc) => weekHours[wc.mondayISO] ?? 0);
  const max = Math.max(...values, 1);
  const w = 100;
  const h = 28;
  const barW = Math.max(2, (w - (values.length - 1) * 1) / values.length);

  return (
    <svg width={w} height={h} className="inline-block">
      {values.map((v, i) => {
        const barH = (v / max) * (h - 2);
        return (
          <rect
            key={i}
            x={i * (barW + 1)}
            y={h - barH}
            width={barW}
            height={barH}
            rx={1}
            fill={v > 0 ? "#97caeb" : "#e5e7eb"}
          />
        );
      })}
    </svg>
  );
}

export default function ReportsPage() {
  const { user, loading: authLoading } = useAuth();
  const [entries, setEntries] = useState<RawEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [weeksBack, setWeeksBack] = useState(4);
  const [drilldown, setDrilldown] = useState<DrilldownSelection>(null);
  const [drilldownData, setDrilldownData] = useState<DrilldownEntry[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [bradfordData, setBradfordData] = useState<{ name: string; bradford: BradfordResult }[]>([]);
  const [descMap, setDescMap] = useState<Map<string, string>>(new Map());
  const [approvalMap, setApprovalMap] = useState<Map<string, number>>(new Map()); // mondayISO → approved count
  const [activeEmployeeCount, setActiveEmployeeCount] = useState(0);

  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    const currentMonday = getMonday(now);
    const start = new Date(currentMonday);
    start.setDate(start.getDate() - (weeksBack - 1) * 7);
    return { rangeStart: toISO(start), rangeEnd: toISO(now) };
  }, [weeksBack]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("timesheet_entries")
        .select("project_item, work_date, hours, employee_id")
        .gte("work_date", rangeStart)
        .lte("work_date", rangeEnd)
        .order("project_item")
        .order("work_date");

      if (cancelled) return;
      if (error) {
        console.error("Failed to load report data", error);
        setLoading(false);
        return;
      }
      setEntries(data ?? []);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd]);

  // Load approval status per week
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Get active employee count
      const { count } = await supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("active", true);

      if (cancelled) return;
      setActiveEmployeeCount(count ?? 0);

      // Get all approvals in the date range
      const { data: approvals } = await supabase
        .from("timesheet_approvals")
        .select("week_start")
        .gte("week_start", rangeStart)
        .lte("week_start", rangeEnd);

      if (cancelled) return;

      const m = new Map<string, number>();
      for (const a of approvals ?? []) {
        m.set(a.week_start, (m.get(a.week_start) ?? 0) + 1);
      }
      setApprovalMap(m);
    })();
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd]);

  // Load project item descriptions
  useEffect(() => {
    (async () => {
      const m = new Map<string, string>();
      // Persistent items
      m.set("SHOPWORK-01", "Shop Work");
      m.set("HOLIDAY-01", "Holiday");
      m.set("TRAINING-01", "Training");
      m.set("SICK-01", "Sick");

      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data } = await supabase
          .from("project_register_items")
          .select("projectnumber, item_seq, line_desc")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          m.set(`${r.projectnumber}-${String(r.item_seq).padStart(2, "0")}`, r.line_desc);
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setDescMap(m);
    })();
  }, []);

  // Load Bradford scores
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sickEntries } = await supabase
        .from("timesheet_entries")
        .select("employee_id, work_date")
        .eq("project_item", "SICK-01");

      if (cancelled || !sickEntries) return;

      const empIds = [...new Set(sickEntries.map((e) => e.employee_id))];
      if (empIds.length === 0) { setBradfordData([]); return; }

      const { data: employees } = await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .in("id", empIds);

      if (cancelled) return;

      const empMap = new Map(
        (employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`])
      );

      // Also fetch all active employees with no sick days
      const { data: allEmployees } = await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .eq("active", true);

      if (cancelled) return;

      const sickMap = new Map<string, string[]>();
      for (const e of sickEntries) {
        if (!sickMap.has(e.employee_id)) sickMap.set(e.employee_id, []);
        sickMap.get(e.employee_id)!.push(e.work_date);
      }

      const results = (allEmployees ?? []).map((emp) => ({
        name: `${emp.first_name} ${emp.last_name}`,
        bradford: calculateBradford(sickMap.get(emp.id) ?? []),
      })).sort((a, b) => b.bradford.score - a.bradford.score);

      if (!cancelled) setBradfordData(results);
    })();
    return () => { cancelled = true; };
  }, []);

  // Load drilldown data
  useEffect(() => {
    if (!drilldown) { setDrilldownData([]); return; }
    let cancelled = false;

    (async () => {
      setDrilldownLoading(true);
      const mon = new Date(drilldown.mondayISO + "T00:00:00");
      const weekDts = getWeekDates(mon);
      const weekStart = toISO(weekDts[0]);
      const weekEnd = toISO(weekDts[6]);

      const { data: rawEntries } = await supabase
        .from("timesheet_entries")
        .select("work_date, hours, employee_id")
        .eq("project_item", drilldown.project_item)
        .gte("work_date", weekStart)
        .lte("work_date", weekEnd)
        .order("work_date");

      if (cancelled) return;

      const empIds = [...new Set((rawEntries ?? []).map((e) => e.employee_id))];
      const { data: employees } = await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .in("id", empIds);

      if (cancelled) return;

      const empMap = new Map(
        (employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`])
      );

      const result: DrilldownEntry[] = (rawEntries ?? []).map((e) => ({
        employee_name: empMap.get(e.employee_id) ?? "Unknown",
        work_date: e.work_date,
        hours: Number(e.hours),
      }));

      if (!cancelled) { setDrilldownData(result); setDrilldownLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [drilldown]);

  const weekColumns = useMemo<WeekColumn[]>(() => {
    const cols: WeekColumn[] = [];
    const now = new Date();
    const currentMonday = getMonday(now);
    for (let i = weeksBack - 1; i >= 0; i--) {
      const mon = new Date(currentMonday);
      mon.setDate(mon.getDate() - i * 7);
      cols.push({ mondayISO: toISO(mon), label: formatWeekRange(mon) });
    }
    return cols;
  }, [weeksBack]);

  // Build project groups with item breakdown
  const projectGroups = useMemo<ProjectGroup[]>(() => {
    // First build item-level rows
    const itemMap = new Map<string, Record<string, number>>();

    for (const e of entries) {
      const entryDate = new Date(e.work_date + "T00:00:00");
      const mondayISO = toISO(getMonday(entryDate));

      if (!itemMap.has(e.project_item)) {
        itemMap.set(e.project_item, {});
      }
      const weekHours = itemMap.get(e.project_item)!;
      weekHours[mondayISO] = (weekHours[mondayISO] ?? 0) + Number(e.hours);
    }

    const itemRows: ItemRow[] = Array.from(itemMap.entries())
      .map(([project_item, weekHours]) => ({
        project_item,
        weekHours,
        total: Object.values(weekHours).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => a.project_item.localeCompare(b.project_item));

    // Group by project number (everything before the last dash-digits)
    const groupMap = new Map<string, ItemRow[]>();
    for (const item of itemRows) {
      const dashIdx = item.project_item.lastIndexOf("-");
      const proj = dashIdx > 0 ? item.project_item.substring(0, dashIdx) : item.project_item;
      if (!groupMap.has(proj)) groupMap.set(proj, []);
      groupMap.get(proj)!.push(item);
    }

    const groups: ProjectGroup[] = Array.from(groupMap.entries())
      .map(([projectnumber, items]) => {
        const weekHours: Record<string, number> = {};
        let total = 0;
        for (const item of items) {
          total += item.total;
          for (const [week, hours] of Object.entries(item.weekHours)) {
            weekHours[week] = (weekHours[week] ?? 0) + hours;
          }
        }
        return {
          projectnumber,
          weekHours,
          total,
          items,
          hasMultipleItems: items.length > 1,
        };
      })
      .sort((a, b) => {
        const BOTTOM = new Set(["SHOPWORK", "HOLIDAY", "TRAINING", "SICK"]);
        const aBottom = BOTTOM.has(a.projectnumber);
        const bBottom = BOTTOM.has(b.projectnumber);
        if (aBottom !== bBottom) return aBottom ? 1 : -1;
        return a.projectnumber.localeCompare(b.projectnumber);
      });

    return groups;
  }, [entries]);

  const weekTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const g of projectGroups) {
      for (const [week, hours] of Object.entries(g.weekHours)) {
        totals[week] = (totals[week] ?? 0) + hours;
      }
    }
    return totals;
  }, [projectGroups]);

  const grandTotal = projectGroups.reduce((sum, g) => sum + g.total, 0);

  // Overtime calculation: per employee per week, 40h hurdle
  const OT_HURDLE = 40;
  const { weekStraight, weekOvertime, totalStraight, totalOvertime } = useMemo(() => {
    // Sum total hours per employee per week
    const empWeekHours = new Map<string, Map<string, number>>();
    for (const e of entries) {
      const entryDate = new Date(e.work_date + "T00:00:00");
      const mondayISO = toISO(getMonday(entryDate));

      if (!empWeekHours.has(e.employee_id)) {
        empWeekHours.set(e.employee_id, new Map());
      }
      const weekMap = empWeekHours.get(e.employee_id)!;
      weekMap.set(mondayISO, (weekMap.get(mondayISO) ?? 0) + Number(e.hours));
    }

    // For each week, sum straight and OT across all employees
    const wStraight: Record<string, number> = {};
    const wOvertime: Record<string, number> = {};

    for (const [, weekMap] of empWeekHours) {
      for (const [mondayISO, totalHrs] of weekMap) {
        const st = Math.min(totalHrs, OT_HURDLE);
        const ot = Math.max(totalHrs - OT_HURDLE, 0);
        wStraight[mondayISO] = (wStraight[mondayISO] ?? 0) + st;
        wOvertime[mondayISO] = (wOvertime[mondayISO] ?? 0) + ot;
      }
    }

    let tStraight = 0;
    let tOvertime = 0;
    for (const v of Object.values(wStraight)) tStraight += v;
    for (const v of Object.values(wOvertime)) tOvertime += v;

    return {
      weekStraight: wStraight,
      weekOvertime: wOvertime,
      totalStraight: tStraight,
      totalOvertime: tOvertime,
    };
  }, [entries]);

  const handleCellClick = (project_item: string, mondayISO: string, hours: number) => {
    if (hours === 0) return;
    if (drilldown?.project_item === project_item && drilldown?.mondayISO === mondayISO) {
      setDrilldown(null);
      return;
    }
    setDrilldown({ project_item, mondayISO });
  };

  const isSelected = (project_item: string, mondayISO: string) =>
    drilldown?.project_item === project_item && drilldown?.mondayISO === mondayISO;

  const toggleExpand = (projectnumber: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectnumber)) next.delete(projectnumber);
      else next.add(projectnumber);
      return next;
    });
  };

  // Drilldown by employee
  const drilldownByEmployee = useMemo(() => {
    if (!drilldown) return null;
    const mon = new Date(drilldown.mondayISO + "T00:00:00");
    const weekDts = getWeekDates(mon);
    const weekISOs = weekDts.map(toISO);

    const empMap = new Map<string, Record<string, number>>();
    for (const e of drilldownData) {
      if (!empMap.has(e.employee_name)) empMap.set(e.employee_name, {});
      empMap.get(e.employee_name)![e.work_date] = e.hours;
    }

    return {
      weekDates: weekDts,
      weekISOs,
      employees: Array.from(empMap.entries())
        .map(([name, days]) => ({
          name,
          days,
          total: Object.values(days).reduce((a, b) => a + b, 0),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [drilldownData, drilldown]);

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
        <h1 className="text-2xl font-semibold">Project Hours Report</h1>
        <p className="text-gray-600">Sign in to view reports</p>
        <AuthButton redirectTo="/reports/" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 max-w-full mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-semibold">Project Hours Report</h1>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <label className="text-sm font-medium">Show last:</label>
        {[4, 8, 12, 26, 52].map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => { setWeeksBack(w); setDrilldown(null); }}
            className={`rounded border px-3 py-1 text-sm cursor-pointer ${
              weeksBack === w ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-100"
            }`}
          >
            {w} weeks
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-4">Loading report...</div>
      ) : projectGroups.length === 0 ? (
        <div className="text-gray-500 py-8 text-center border rounded">
          No timesheet data found for this period
        </div>
      ) : (
        <>
          <div className="overflow-auto border rounded" style={{ maxHeight: "calc(100vh - 200px)" }}>
            <table className="border-collapse text-sm w-full">
              <thead className="sticky top-0 z-20">
                <tr className="bg-gray-50">
                  <th className="border px-3 py-2 text-left sticky left-0 bg-gray-50 z-30 min-w-48">
                    Project
                  </th>
                  {weekColumns.map((wc) => (
                    <th key={wc.mondayISO} className="border px-2 py-2 text-center text-xs whitespace-nowrap min-w-24 bg-gray-50">
                      {wc.label.split(" – ")[0]}<br />
                      <span className="text-gray-400">{wc.label.split(" – ")[1]}</span>
                    </th>
                  ))}
                  <th className="border px-3 py-2 text-center font-bold min-w-20 sticky right-28 bg-gray-50 z-30">Total</th>
                  <th className="border px-2 py-2 text-center text-xs min-w-28 sticky right-0 bg-gray-50 z-30">Trend</th>
                </tr>
              </thead>
              <tbody>
                {projectGroups.map((group) => {
                  const expanded = expandedProjects.has(group.projectnumber);
                  return (
                    <Fragment key={group.projectnumber}>
                      {/* Project total row */}
                      <tr className={`${group.hasMultipleItems ? "font-medium" : ""} hover:bg-gray-50`}>
                        <td className="border px-3 py-1.5 font-mono text-xs sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-1">
                            {group.hasMultipleItems && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(group.projectnumber)}
                                className="text-gray-400 hover:text-gray-600 cursor-pointer w-4"
                              >
                                {expanded ? "▼" : "▶"}
                              </button>
                            )}
                            <div>
                              <span>{group.hasMultipleItems ? group.projectnumber : group.items[0].project_item}</span>
                              {(() => {
                                const desc = group.hasMultipleItems
                                  ? null
                                  : descMap.get(group.items[0].project_item);
                                return desc ? (
                                  <div className="text-xs text-gray-500 font-sans truncate max-w-48">{desc}</div>
                                ) : null;
                              })()}
                            </div>
                          </div>
                        </td>
                        {weekColumns.map((wc) => {
                          const h = group.weekHours[wc.mondayISO] ?? 0;
                          const clickItem = group.hasMultipleItems
                            ? null
                            : group.items[0].project_item;
                          const sel = clickItem ? isSelected(clickItem, wc.mondayISO) : false;
                          return (
                            <td
                              key={wc.mondayISO}
                              onClick={() => clickItem && handleCellClick(clickItem, wc.mondayISO, h)}
                              className={`border px-2 py-1.5 text-center ${
                                h > 0 && clickItem ? "cursor-pointer hover:bg-blue-50" : ""
                              } ${sel ? "bg-blue-100 ring-2 ring-blue-400 ring-inset" : ""}`}
                            >
                              {h > 0 ? h : "–"}
                            </td>
                          );
                        })}
                        <td className="border px-3 py-1.5 text-center font-bold sticky right-28 bg-white z-10">{group.total}</td>
                        <td className="border px-2 py-1 text-center sticky right-0 bg-white z-10">
                          <Sparkline weekHours={group.weekHours} weekColumns={weekColumns} />
                        </td>
                      </tr>

                      {/* Indented item rows (only if multiple items and expanded) */}
                      {group.hasMultipleItems && expanded && group.items.map((item) => (
                        <tr key={item.project_item} className="hover:bg-gray-50 text-gray-600">
                          <td className="border px-3 py-1 font-mono text-xs sticky left-0 bg-white z-10 pl-8">
                            {item.project_item}
                            {descMap.get(item.project_item) && (
                              <span className="text-gray-400 font-sans ml-2">{descMap.get(item.project_item)}</span>
                            )}
                          </td>
                          {weekColumns.map((wc) => {
                            const h = item.weekHours[wc.mondayISO] ?? 0;
                            const sel = isSelected(item.project_item, wc.mondayISO);
                            return (
                              <td
                                key={wc.mondayISO}
                                onClick={() => handleCellClick(item.project_item, wc.mondayISO, h)}
                                className={`border px-2 py-1 text-center ${
                                  h > 0 ? "cursor-pointer hover:bg-blue-50" : ""
                                } ${sel ? "bg-blue-100 ring-2 ring-blue-400 ring-inset" : ""}`}
                              >
                                {h > 0 ? h : "–"}
                              </td>
                            );
                          })}
                          <td className="border px-3 py-1 text-center font-medium sticky right-28 bg-white z-10">{item.total}</td>
                          <td className="border px-2 py-1 text-center sticky right-0 bg-white z-10">
                            <Sparkline weekHours={item.weekHours} weekColumns={weekColumns} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}

                {/* Totals row */}
                <tr className="bg-gray-50 font-medium sticky bottom-20 z-20">
                  <td className="border px-3 py-2 text-right sticky left-0 bg-gray-50 z-30">Weekly totals</td>
                  {weekColumns.map((wc) => {
                    const t = weekTotals[wc.mondayISO] ?? 0;
                    return (
                      <td key={wc.mondayISO} className="border px-2 py-2 text-center bg-gray-50">
                        {t > 0 ? t : "–"}
                      </td>
                    );
                  })}
                  <td className="border px-3 py-2 text-center font-bold text-lg sticky right-28 bg-gray-50 z-30">{grandTotal}</td>
                  <td className="border px-2 py-1 text-center sticky right-0 bg-gray-50 z-30">
                    <Sparkline weekHours={weekTotals} weekColumns={weekColumns} />
                  </td>
                </tr>

                {/* Straight time row */}
                <tr className="bg-gray-50 text-xs sticky bottom-13 z-20">
                  <td className="border px-3 py-1.5 text-right text-gray-600 sticky left-0 bg-gray-50 z-30">
                    Straight time (≤{OT_HURDLE}h/employee/week)
                  </td>
                  {weekColumns.map((wc) => {
                    const st = weekStraight[wc.mondayISO] ?? 0;
                    return (
                      <td key={wc.mondayISO} className="border px-2 py-1.5 text-center text-gray-600 bg-gray-50">
                        {st > 0 ? st : "–"}
                      </td>
                    );
                  })}
                  <td className="border px-3 py-1.5 text-center font-medium text-gray-700 sticky right-28 bg-gray-50 z-30">
                    {totalStraight > 0 ? totalStraight : "–"}
                  </td>
                  <td className="border sticky right-0 bg-gray-50 z-30"></td>
                </tr>

                {/* Overtime row */}
                <tr className={`text-xs sticky bottom-6.5 z-20 ${totalOvertime > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
                  <td className={`border px-3 py-1.5 text-right sticky left-0 z-30 ${totalOvertime > 0 ? "bg-amber-50 text-amber-700 font-medium" : "bg-gray-50 text-gray-600"}`}>
                    Overtime (&gt;{OT_HURDLE}h/employee/week)
                  </td>
                  {weekColumns.map((wc) => {
                    const ot = weekOvertime[wc.mondayISO] ?? 0;
                    return (
                      <td key={wc.mondayISO} className={`border px-2 py-1.5 text-center ${ot > 0 ? "text-amber-700 font-medium" : ""} ${totalOvertime > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
                        {ot > 0 ? ot : "–"}
                      </td>
                    );
                  })}
                  <td className={`border px-3 py-1.5 text-center font-bold sticky right-28 z-30 ${totalOvertime > 0 ? "text-amber-700 bg-amber-50" : "bg-gray-50"}`}>
                    {totalOvertime > 0 ? totalOvertime : "–"}
                  </td>
                  <td className={`border sticky right-0 z-30 ${totalOvertime > 0 ? "bg-amber-50" : "bg-gray-50"}`}></td>
                </tr>

                {/* Approval status row */}
                <tr className="sticky bottom-0 z-20 bg-white">
                  <td className="border px-3 py-1.5 text-right text-xs font-medium sticky left-0 bg-white z-30">
                    Approval status
                  </td>
                  {weekColumns.map((wc) => {
                    const approved = approvalMap.get(wc.mondayISO) ?? 0;
                    const allApproved = activeEmployeeCount > 0 && approved >= activeEmployeeCount;
                    return (
                      <td key={wc.mondayISO} className="border px-2 py-1.5 text-center text-xs">
                        {allApproved ? (
                          <span className="text-green-600 font-medium">&#10003; All</span>
                        ) : (
                          <span className={approved > 0 ? "text-amber-600 font-medium" : "text-gray-400"}>
                            {approved}/{activeEmployeeCount}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="border px-3 py-1.5 text-center sticky right-28 bg-white z-30"></td>
                  <td className="border sticky right-0 bg-white z-30"></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Drilldown panel */}
          {drilldown && (
            <div className="mt-6 border rounded bg-white">
              <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
                <div className="text-sm font-medium">
                  <span className="font-mono">{drilldown.project_item}</span>
                  {" — "}
                  {formatWeekRange(new Date(drilldown.mondayISO + "T00:00:00"))}
                </div>
                <button
                  type="button"
                  onClick={() => setDrilldown(null)}
                  className="text-gray-400 hover:text-gray-600 cursor-pointer text-sm"
                >
                  ✕ Close
                </button>
              </div>

              {drilldownLoading ? (
                <div className="px-4 py-4 text-sm text-gray-500">Loading breakdown...</div>
              ) : drilldownByEmployee && drilldownByEmployee.employees.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border-b px-4 py-2 text-left">Employee</th>
                        {drilldownByEmployee.weekDates.map((d, i) => (
                          <th key={i} className="border-b px-2 py-2 text-center w-18">
                            <div>{DAY_LABELS[i]}</div>
                            <div className="text-xs text-gray-500 font-normal">
                              {d.getDate()}/{d.getMonth() + 1}
                            </div>
                          </th>
                        ))}
                        <th className="border-b px-3 py-2 text-center">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drilldownByEmployee.employees.map((emp) => (
                        <tr key={emp.name} className="hover:bg-gray-50">
                          <td className="border-b px-4 py-1.5">{emp.name}</td>
                          {drilldownByEmployee.weekISOs.map((iso) => {
                            const h = emp.days[iso] ?? 0;
                            return (
                              <td key={iso} className="border-b px-2 py-1.5 text-center">
                                {h > 0 ? h : "–"}
                              </td>
                            );
                          })}
                          <td className="border-b px-3 py-1.5 text-center font-medium">{emp.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-4 text-sm text-gray-500">No entries found</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Bradford Factor */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-3">Bradford Factor</h2>
        <p className="text-xs text-gray-500 mb-3">
          B = S² x D — where S = separate sickness spells, D = total sick days (Mon–Thu only).
          Calculated across all available data.
        </p>
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="border px-4 py-2 text-left min-w-48">Employee</th>
                <th className="border px-3 py-2 text-center">Spells</th>
                <th className="border px-3 py-2 text-center">Days</th>
                <th className="border px-3 py-2 text-center">Score</th>
                <th className="border px-3 py-2 text-center">Level</th>
              </tr>
            </thead>
            <tbody>
              {bradfordData.map((row) => {
                const th = BRADFORD_THRESHOLDS[row.bradford.level];
                return (
                  <tr key={row.name} className="hover:bg-gray-50">
                    <td className="border px-4 py-1.5">{row.name}</td>
                    <td className="border px-3 py-1.5 text-center">{row.bradford.spells}</td>
                    <td className="border px-3 py-1.5 text-center">{row.bradford.days}</td>
                    <td className={`border px-3 py-1.5 text-center font-bold ${th.color}`}>
                      {row.bradford.score}
                    </td>
                    <td className="border px-3 py-1.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${th.bg} ${th.color}`}>
                        {th.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {bradfordData.length === 0 && (
                <tr>
                  <td colSpan={5} className="border px-4 py-4 text-center text-gray-500">
                    No sickness data recorded
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
