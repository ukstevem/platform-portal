"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { getMonday, toISO, formatWeekRange, getWeekDates, DAY_LABELS } from "@/lib/weekHelpers";
import { calculateBradford, BRADFORD_THRESHOLDS, type BradfordResult } from "@/lib/bradford";
import XLSX from "xlsx-js-style";

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
  const [viewMode, setViewMode] = useState<"weekly" | "monthly">("monthly");
  const [weeksBack, setWeeksBack] = useState(4);
  const [monthsBack, setMonthsBack] = useState(3);

  // Highlight a project from URL param (e.g. ?highlight=10312)
  const [highlightProject, setHighlightProject] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = params.get("highlight");
    if (h) setHighlightProject(h);
  }, []);
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
    if (viewMode === "monthly") {
      const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
      return { rangeStart: toISO(start), rangeEnd: toISO(now) };
    }
    const currentMonday = getMonday(now);
    const start = new Date(currentMonday);
    start.setDate(start.getDate() - (weeksBack - 1) * 7);
    return { rangeStart: toISO(start), rangeEnd: toISO(now) };
  }, [weeksBack, monthsBack, viewMode]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      let all: RawEntry[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("timesheet_entries")
          .select("project_item, work_date, hours, employee_id")
          .gte("work_date", rangeStart)
          .lte("work_date", rangeEnd)
          .order("project_item")
          .order("work_date")
          .range(from, from + pageSize - 1);

        if (cancelled) return;
        if (error) {
          console.error("Failed to load report data", error);
          break;
        }
        all = all.concat(data ?? []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }

      if (cancelled) return;
      setEntries(all);
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

      let periodStart: string;
      let periodEnd: string;
      const isMonthKey = drilldown.mondayISO.length === 7; // "2026-03"

      if (isMonthKey) {
        const [y, m] = drilldown.mondayISO.split("-").map(Number);
        periodStart = `${y}-${String(m).padStart(2, "0")}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        periodEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      } else {
        const mon = new Date(drilldown.mondayISO + "T00:00:00");
        const weekDts = getWeekDates(mon);
        periodStart = toISO(weekDts[0]);
        periodEnd = toISO(weekDts[6]);
      }

      const { data: rawEntries } = await supabase
        .from("timesheet_entries")
        .select("work_date, hours, employee_id")
        .eq("project_item", drilldown.project_item)
        .gte("work_date", periodStart)
        .lte("work_date", periodEnd)
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

  // Returns the bucket key for a given date (mondayISO for weekly, YYYY-MM for monthly)
  const getBucketKey = useMemo(() => {
    if (viewMode === "monthly") {
      return (dateStr: string) => dateStr.slice(0, 7); // "2026-03"
    }
    return (dateStr: string) => {
      const d = new Date(dateStr + "T00:00:00");
      return toISO(getMonday(d));
    };
  }, [viewMode]);

  const weekColumns = useMemo<WeekColumn[]>(() => {
    const cols: WeekColumn[] = [];
    const now = new Date();
    if (viewMode === "monthly") {
      for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
        cols.push({ mondayISO: key, label });
      }
    } else {
      const currentMonday = getMonday(now);
      for (let i = weeksBack - 1; i >= 0; i--) {
        const mon = new Date(currentMonday);
        mon.setDate(mon.getDate() - i * 7);
        cols.push({ mondayISO: toISO(mon), label: formatWeekRange(mon) });
      }
    }
    return cols;
  }, [weeksBack, monthsBack, viewMode]);

  // Build project groups with item breakdown
  const projectGroups = useMemo<ProjectGroup[]>(() => {
    // First build item-level rows
    const itemMap = new Map<string, Record<string, number>>();

    for (const e of entries) {
      if (e.project_item === "SICK-01") continue; // Sick tracked separately
      const bucketKey = getBucketKey(e.work_date);

      if (!itemMap.has(e.project_item)) {
        itemMap.set(e.project_item, {});
      }
      const weekHours = itemMap.get(e.project_item)!;
      weekHours[bucketKey] = (weekHours[bucketKey] ?? 0) + Number(e.hours);
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
        const BOTTOM = new Set(["SHOPWORK", "HOLIDAY", "TRAINING"]);
        const aBottom = BOTTOM.has(a.projectnumber);
        const bBottom = BOTTOM.has(b.projectnumber);
        if (aBottom !== bBottom) return aBottom ? 1 : -1;
        return a.projectnumber.localeCompare(b.projectnumber);
      });

    return groups;
  }, [entries, getBucketKey]);

  // Sick hours tracked separately (not in totals)
  const sickByWeek = useMemo(() => {
    const m: Record<string, number> = {};
    let total = 0;
    for (const e of entries) {
      if (e.project_item !== "SICK-01") continue;
      const key = getBucketKey(e.work_date);
      const hrs = Number(e.hours);
      m[key] = (m[key] ?? 0) + hrs;
      total += hrs;
    }
    return { weekHours: m, total };
  }, [entries, getBucketKey]);

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

  // Overtime calculation: always per employee per week (40h hurdle),
  // then bucketed into the current view columns
  const OT_HURDLE = 40;
  const { weekStraight, weekOvertime, totalStraight, totalOvertime } = useMemo(() => {
    // Sum total hours per employee per WEEK (OT is always weekly)
    const empWeekHours = new Map<string, Map<string, number>>();
    for (const e of entries) {
      if (e.project_item === "SICK-01") continue; // Sick excluded from OT calc
      const entryDate = new Date(e.work_date + "T00:00:00");
      const mondayISO = toISO(getMonday(entryDate));

      if (!empWeekHours.has(e.employee_id)) {
        empWeekHours.set(e.employee_id, new Map());
      }
      const weekMap = empWeekHours.get(e.employee_id)!;
      weekMap.set(mondayISO, (weekMap.get(mondayISO) ?? 0) + Number(e.hours));
    }

    // Calculate ST/OT per employee per week, then bucket into view columns
    const wStraight: Record<string, number> = {};
    const wOvertime: Record<string, number> = {};

    for (const [empId, weekMap] of empWeekHours) {
      for (const [mondayISO, totalHrs] of weekMap) {
        const st = Math.min(totalHrs, OT_HURDLE);
        const ot = Math.max(totalHrs - OT_HURDLE, 0);
        // Bucket by view mode: for monthly, use the monday's month
        const bucketKey = viewMode === "monthly" ? mondayISO.slice(0, 7) : mondayISO;
        wStraight[bucketKey] = (wStraight[bucketKey] ?? 0) + st;
        wOvertime[bucketKey] = (wOvertime[bucketKey] ?? 0) + ot;
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
  }, [entries, viewMode]);

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

    const isMonthKey = drilldown.mondayISO.length === 7;

    let dateCols: { iso: string; label: string }[];
    if (isMonthKey) {
      // Monthly: show week columns within the month
      const [y, m] = drilldown.mondayISO.split("-").map(Number);
      const firstDay = new Date(y, m - 1, 1);
      const lastDay = new Date(y, m, 0).getDate();
      const weeks: { iso: string; label: string }[] = [];
      // Find all Mondays in the month (or start from day 1 if not Monday)
      let d = new Date(firstDay);
      // Go to first Monday
      while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
      // Include week starting before month if month doesn't start on Monday
      if (d.getDate() > 1) {
        const prevMon = new Date(d);
        prevMon.setDate(prevMon.getDate() - 7);
        weeks.push({ iso: toISO(prevMon), label: `W/C ${prevMon.getDate()}/${prevMon.getMonth() + 1}` });
      }
      while (d.getMonth() === m - 1) {
        weeks.push({ iso: toISO(d), label: `W/C ${d.getDate()}/${d.getMonth() + 1}` });
        d.setDate(d.getDate() + 7);
      }
      dateCols = weeks;
    } else {
      const mon = new Date(drilldown.mondayISO + "T00:00:00");
      const weekDts = getWeekDates(mon);
      dateCols = weekDts.map((dt, i) => ({
        iso: toISO(dt),
        label: `${DAY_LABELS[i]} ${dt.getDate()}/${dt.getMonth() + 1}`,
      }));
    }

    // Bucket employee hours into date columns
    const empMap = new Map<string, Record<string, number>>();
    for (const e of drilldownData) {
      if (!empMap.has(e.employee_name)) empMap.set(e.employee_name, {});
      if (isMonthKey) {
        // Bucket by week (find which Monday this date belongs to)
        const entryDate = new Date(e.work_date + "T00:00:00");
        const mondayISO = toISO(getMonday(entryDate));
        const rec = empMap.get(e.employee_name)!;
        rec[mondayISO] = (rec[mondayISO] ?? 0) + e.hours;
      } else {
        empMap.get(e.employee_name)![e.work_date] = e.hours;
      }
    }

    return {
      dateCols,
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
        <div className="flex rounded border overflow-hidden">
          <button
            type="button"
            onClick={() => { setViewMode("weekly"); setDrilldown(null); }}
            className={`px-3 py-1 text-sm cursor-pointer ${
              viewMode === "weekly" ? "bg-blue-600 text-white" : "hover:bg-gray-100"
            }`}
          >
            Weekly
          </button>
          <button
            type="button"
            onClick={() => { setViewMode("monthly"); setDrilldown(null); }}
            className={`px-3 py-1 text-sm cursor-pointer ${
              viewMode === "monthly" ? "bg-blue-600 text-white" : "hover:bg-gray-100"
            }`}
          >
            Monthly
          </button>
        </div>
        <label className="text-sm font-medium">Show last:</label>
        {viewMode === "weekly" ? (
          [4, 8, 12, 26, 52].map((w) => (
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
          ))
        ) : (
          [3, 6, 12].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMonthsBack(m); setDrilldown(null); }}
              className={`rounded border px-3 py-1 text-sm cursor-pointer ${
                monthsBack === m ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-100"
              }`}
            >
              {m} months
            </button>
          ))
        )}
        <button
          type="button"
          onClick={() => {
            const NAVY = "061B37";
            const borderThin = {
              top: { style: "thin", color: { rgb: "000000" } },
              bottom: { style: "thin", color: { rgb: "000000" } },
              left: { style: "thin", color: { rgb: "000000" } },
              right: { style: "thin", color: { rgb: "000000" } },
            } as const;
            const hdrStyle = {
              font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
              fill: { fgColor: { rgb: NAVY } },
              alignment: { horizontal: "center" as const, vertical: "center" as const },
              border: borderThin,
            };
            const titleStyle = { font: { bold: true, sz: 14, color: { rgb: NAVY } } };
            const cellText = { font: { sz: 10 }, border: borderThin, alignment: { vertical: "center" as const } };
            const cellNum = { ...cellText, alignment: { horizontal: "right" as const, vertical: "center" as const }, numFmt: "0.00" };
            const cellBold = { ...cellNum, font: { sz: 10, bold: true } };
            const cellIndent = { ...cellText, font: { sz: 9, color: { rgb: "666666" } } };
            const cellOT = { ...cellNum, font: { sz: 10, color: { rgb: "D97706" } } };
            const totalRowStyle = { ...cellBold, fill: { fgColor: { rgb: "F3F4F6" } } };
            const totalRowLabel = { ...cellText, font: { sz: 10, bold: true }, fill: { fgColor: { rgb: "F3F4F6" } }, alignment: { horizontal: "right" as const, vertical: "center" as const } };

            const nc = (v: number, s: object) => v > 0 ? { v, t: "n", s } : { v: "", t: "s", s: cellText };
            const tc = (v: string, s?: object) => ({ v, t: "s", s: s ?? cellText });

            const colHeaders = ["Project", ...weekColumns.map((wc) => wc.label), "Total"];
            const wsRows: object[][] = [
              [{ v: viewMode === "monthly" ? `Project Hours Report — ${monthsBack} months` : `Project Hours Report — ${weeksBack} weeks`, t: "s", s: titleStyle }],
              [],
              colHeaders.map((h) => ({ v: h, t: "s", s: hdrStyle })),
            ];

            for (const group of projectGroups) {
              const label = group.hasMultipleItems ? group.projectnumber : group.items[0].project_item;
              const desc = group.hasMultipleItems ? "" : (descMap.get(group.items[0].project_item) ?? "");
              const displayName = desc ? `${label} — ${desc}` : label;
              const style = group.hasMultipleItems ? cellBold : cellNum;
              wsRows.push([
                tc(displayName, group.hasMultipleItems ? { ...cellText, font: { sz: 10, bold: true } } : cellText),
                ...weekColumns.map((wc) => nc(group.weekHours[wc.mondayISO] ?? 0, style)),
                nc(group.total, cellBold),
              ]);
              if (group.hasMultipleItems) {
                for (const item of group.items) {
                  const itemDesc = descMap.get(item.project_item) ?? "";
                  wsRows.push([
                    tc(`  ${item.project_item}${itemDesc ? ` — ${itemDesc}` : ""}`, cellIndent),
                    ...weekColumns.map((wc) => nc(item.weekHours[wc.mondayISO] ?? 0, cellNum)),
                    nc(item.total, cellNum),
                  ]);
                }
              }
            }
            wsRows.push([]);
            wsRows.push([tc("Weekly totals", totalRowLabel), ...weekColumns.map((wc) => nc(weekTotals[wc.mondayISO] ?? 0, totalRowStyle)), nc(grandTotal, totalRowStyle)]);
            wsRows.push([tc("Straight time", totalRowLabel), ...weekColumns.map((wc) => nc(weekStraight[wc.mondayISO] ?? 0, totalRowStyle)), nc(totalStraight, totalRowStyle)]);
            wsRows.push([tc("Overtime", totalRowLabel), ...weekColumns.map((wc) => nc(weekOvertime[wc.mondayISO] ?? 0, cellOT)), nc(totalOvertime, cellOT)]);

            // Sick row (separate from totals)
            if (sickByWeek.total > 0) {
              const cellSick = { ...cellNum, font: { sz: 10, color: { rgb: "DC2626" } } };
              const sickLabel = { ...totalRowLabel, font: { sz: 10, bold: true, color: { rgb: "DC2626" } }, fill: { fgColor: { rgb: "FEF2F2" } } };
              const sickCell = { ...cellSick, fill: { fgColor: { rgb: "FEF2F2" } } };
              wsRows.push([]);
              wsRows.push([tc("Sick (not included in totals)", sickLabel), ...weekColumns.map((wc) => nc(sickByWeek.weekHours[wc.mondayISO] ?? 0, sickCell)), nc(sickByWeek.total, sickCell)]);
            }

            const ws = XLSX.utils.aoa_to_sheet(wsRows);
            ws["!merges"] = [
              { s: { r: 0, c: 0 }, e: { r: 0, c: weekColumns.length + 1 } },
            ];
            ws["!cols"] = [{ wch: 35 }, ...weekColumns.map(() => ({ wch: 14 })), { wch: 12 }];
            ws["!rows"] = [{ hpt: 24 }, { hpt: 6 }, { hpt: 22 }];

            const wb = XLSX.utils.book_new();
            const sheetName = viewMode === "monthly" ? `${monthsBack}mo` : `${weeksBack}wk`;
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            const now = new Date();
            const dateStr = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
            XLSX.writeFile(wb, `project-hours-${dateStr}-${sheetName}.xlsx`);
          }}
          disabled={projectGroups.length === 0}
          className="rounded border px-3 py-1 text-sm cursor-pointer hover:bg-gray-100 disabled:opacity-50 ml-auto"
        >
          Excel
        </button>
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
                      {viewMode === "monthly" ? (
                        wc.label
                      ) : (
                        <>{wc.label.split(" – ")[0]}<br />
                        <span className="text-gray-400">{wc.label.split(" – ")[1]}</span></>
                      )}
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
                      <tr
                        ref={(el) => {
                          if (highlightProject === group.projectnumber && el && !loading) {
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                          }
                        }}
                        className={`${group.hasMultipleItems ? "font-medium" : ""} hover:bg-gray-50 ${highlightProject === group.projectnumber ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""}`}
                      >
                        <td className={`border px-3 py-1.5 font-mono text-xs sticky left-0 z-10 ${highlightProject === group.projectnumber ? "bg-blue-50" : "bg-white"}`}>
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
                <tr className={`bg-gray-50 font-medium sticky z-20 ${viewMode === "weekly" ? (sickByWeek.total > 0 ? "bottom-32" : "bottom-20") : (sickByWeek.total > 0 ? "bottom-20" : "bottom-13")}`}>
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
                <tr className={`bg-gray-50 text-xs sticky z-20 ${viewMode === "weekly" ? (sickByWeek.total > 0 ? "bottom-26" : "bottom-13") : (sickByWeek.total > 0 ? "bottom-13" : "bottom-6.5")}`}>
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
                <tr className={`text-xs sticky z-20 ${viewMode === "weekly" ? (sickByWeek.total > 0 ? "bottom-20" : "bottom-6.5") : (sickByWeek.total > 0 ? "bottom-6.5" : "bottom-0")} ${totalOvertime > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
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

                {/* Approval status row (weekly view only) */}
                {viewMode === "weekly" && <tr className={`sticky z-20 bg-white ${sickByWeek.total > 0 ? "bottom-6.5" : "bottom-0"}`}>
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
                </tr>}

                {/* Sick row — separate from cost totals */}
                {sickByWeek.total > 0 && (
                  <tr className="bg-red-50 sticky bottom-0 z-20">
                    <td className="border px-3 py-1.5 text-right text-xs font-medium sticky left-0 bg-red-50 z-10 text-red-600">
                      Sick (not included in totals)
                    </td>
                    {weekColumns.map((wc) => {
                      const h = sickByWeek.weekHours[wc.mondayISO] ?? 0;
                      return (
                        <td key={wc.mondayISO} className="border px-2 py-1.5 text-center text-red-600 text-xs">
                          {h > 0 ? h : "–"}
                        </td>
                      );
                    })}
                    <td className="border px-3 py-1.5 text-center font-bold text-red-600 sticky right-28 bg-red-50 z-10">
                      {sickByWeek.total}
                    </td>
                    <td className="border sticky right-0 bg-red-50 z-10"></td>
                  </tr>
                )}
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
                  {drilldown.mondayISO.length === 7
                    ? new Date(drilldown.mondayISO + "-01T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })
                    : formatWeekRange(new Date(drilldown.mondayISO + "T00:00:00"))}
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
                        {drilldownByEmployee.dateCols.map((col) => (
                          <th key={col.iso} className="border-b px-2 py-2 text-center text-xs whitespace-nowrap">
                            {col.label}
                          </th>
                        ))}
                        <th className="border-b px-3 py-2 text-center">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drilldownByEmployee.employees.map((emp) => (
                        <tr key={emp.name} className="hover:bg-gray-50">
                          <td className="border-b px-4 py-1.5">{emp.name}</td>
                          {drilldownByEmployee.dateCols.map((col) => {
                            const h = emp.days[col.iso] ?? 0;
                            return (
                              <td key={col.iso} className="border-b px-2 py-1.5 text-center">
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
