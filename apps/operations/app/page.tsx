"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import XLSX from "xlsx-js-style";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer,
} from "recharts";

type TimesheetEntry = {
  project_item: string;
  hours: number;
  is_overtime: boolean;
  work_date: string;
};

type PurchaseOrder = {
  project_id: string;
  item_seq: number;
  total_value: number;
  invoice_reference: string | null;
  created_at: string;
};

type ItemRow = {
  project_item: string;
  description: string;
  projectValue: number;
  basicHours: number;
  otHours: number;
  labourCost: number;
  committed: number;
  invoiced: number;
  totalCost: number;
};

type ProjectRow = {
  projectnumber: string;
  description: string;
  projectValue: number;
  basicHours: number;
  otHours: number;
  labourCost: number;
  committed: number;
  invoiced: number;
  totalCost: number;
  items: ItemRow[];
  hasMultipleItems: boolean;
};

export default function ProjectCostOverview() {
  const { user, loading: authLoading } = useAuth();
  const [tsEntries, setTsEntries] = useState<TimesheetEntry[]>([]);
  const [poData, setPoData] = useState<PurchaseOrder[]>([]);
  const [descMap, setDescMap] = useState<Map<string, string>>(new Map());
  const [itemDescMap, setItemDescMap] = useState<Map<string, string>>(new Map());
  const [itemValueMap, setItemValueMap] = useState<Map<string, number>>(new Map());
  const [projectValueMap, setProjectValueMap] = useState<Map<string, number>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Configurable rates
  const [basicRate, setBasicRate] = useState(49);
  const [otMultiplier, setOtMultiplier] = useState(1.5);
  const [targetMargin, setTargetMargin] = useState(30);
  const [showSettings, setShowSettings] = useState(false);

  // Load all data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Timesheet entries — paginated
      let allTs: TimesheetEntry[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data } = await supabase
          .from("timesheet_entries")
          .select("project_item, hours, is_overtime, work_date")
          .range(from, from + pageSize - 1);
        if (cancelled) return;
        if (!data || data.length === 0) break;
        allTs = allTs.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Purchase orders — paginated (from accounts_overview for values, purchase_orders for dates)
      let allPo: PurchaseOrder[] = [];
      from = 0;
      // Use accounts_overview for value + invoice info
      const poDateMap = new Map<number, string>();
      // Fetch dates from purchase_orders table
      let dateFrom = 0;
      while (true) {
        const { data } = await supabase
          .from("purchase_orders")
          .select("po_number, created_at")
          .range(dateFrom, dateFrom + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const d of data) poDateMap.set(d.po_number, d.created_at);
        if (data.length < pageSize) break;
        dateFrom += pageSize;
      }
      // Fetch PO values from accounts_overview
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("accounts_overview")
          .select("projectnumber, total_value, invoice_reference, po_number")
          .range(from, from + pageSize - 1);
        if (cancelled) return;
        if (!data || data.length === 0) break;
        allPo = allPo.concat(
          data.map((d: { projectnumber: string; total_value: number; invoice_reference: string | null; po_number: number }) => ({
            project_id: d.projectnumber,
            item_seq: 0,
            total_value: Number(d.total_value) || 0,
            invoice_reference: d.invoice_reference,
            created_at: poDateMap.get(d.po_number) ?? "",
          }))
        );
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Project descriptions and values (per item and rolled up per project)
      const m = new Map<string, string>();
      const iDescMap = new Map<string, string>();
      const iValMap = new Map<string, number>();
      const valMap = new Map<string, number>();
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_register_items")
          .select("projectnumber, item_seq, line_desc, value")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          const itemKey = `${r.projectnumber}-${String(r.item_seq).padStart(2, "0")}`;
          const itemKey01 = `${r.projectnumber}-01`;
          if (!m.has(r.projectnumber) || itemKey === itemKey01) m.set(r.projectnumber, r.line_desc);
          iDescMap.set(itemKey, r.line_desc);
          iValMap.set(itemKey, Number(r.value) || 0);
          valMap.set(r.projectnumber, (valMap.get(r.projectnumber) ?? 0) + (Number(r.value) || 0));
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }

      if (cancelled) return;
      setTsEntries(allTs);
      setPoData(allPo);
      setDescMap(m);
      setItemDescMap(iDescMap);
      setItemValueMap(iValMap);
      setProjectValueMap(valMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Build project rows with sub-items
  const projectRows = useMemo<ProjectRow[]>(() => {
    // Aggregate hours by project_item (e.g. "10312-01")
    const itemHoursMap = new Map<string, { basic: number; ot: number }>();
    for (const e of tsEntries) {
      if (["SHOPWORK-01", "HOLIDAY-01", "TRAINING-01", "SICK-01"].includes(e.project_item)) continue;
      if (!itemHoursMap.has(e.project_item)) itemHoursMap.set(e.project_item, { basic: 0, ot: 0 });
      const entry = itemHoursMap.get(e.project_item)!;
      const hrs = Number(e.hours);
      if (e.is_overtime) { entry.ot += hrs; } else { entry.basic += hrs; }
    }

    // Aggregate PO values by project
    const committedMap = new Map<string, number>();
    const invoicedMap = new Map<string, number>();
    for (const po of poData) {
      const proj = po.project_id;
      if (po.invoice_reference) {
        invoicedMap.set(proj, (invoicedMap.get(proj) ?? 0) + po.total_value);
      } else {
        committedMap.set(proj, (committedMap.get(proj) ?? 0) + po.total_value);
      }
    }

    // Collect all project-item keys and group by project number
    const allItemKeys = new Set([...itemHoursMap.keys(), ...itemValueMap.keys()]);
    const projItemsMap = new Map<string, Set<string>>();
    for (const itemKey of allItemKeys) {
      const dashIdx = itemKey.lastIndexOf("-");
      const proj = dashIdx > 0 ? itemKey.substring(0, dashIdx) : itemKey;
      if (!projItemsMap.has(proj)) projItemsMap.set(proj, new Set());
      projItemsMap.get(proj)!.add(itemKey);
    }

    // Also ensure projects from POs and projectValueMap are included
    const allProjects = new Set([
      ...projItemsMap.keys(),
      ...committedMap.keys(),
      ...invoicedMap.keys(),
      ...projectValueMap.keys(),
    ]);

    const rows: ProjectRow[] = Array.from(allProjects)
      .map((proj) => {
        const committed = committedMap.get(proj) ?? 0;
        const invoiced = invoicedMap.get(proj) ?? 0;
        const projectValue = projectValueMap.get(proj) ?? 0;

        // Build sub-items
        const itemKeys = Array.from(projItemsMap.get(proj) ?? []).sort();
        const items: ItemRow[] = itemKeys.map((itemKey) => {
          const hrs = itemHoursMap.get(itemKey) ?? { basic: 0, ot: 0 };
          const val = itemValueMap.get(itemKey) ?? 0;
          const lc = hrs.basic * basicRate + hrs.ot * basicRate * otMultiplier;
          return {
            project_item: itemKey,
            description: itemDescMap.get(itemKey) ?? "",
            projectValue: val,
            basicHours: hrs.basic,
            otHours: hrs.ot,
            labourCost: lc,
            committed: 0,
            invoiced: 0,
            totalCost: lc,
          };
        });

        // Aggregate hours from items
        const totalBasic = items.reduce((s, i) => s + i.basicHours, 0);
        const totalOT = items.reduce((s, i) => s + i.otHours, 0);
        const labourCost = totalBasic * basicRate + totalOT * basicRate * otMultiplier;

        return {
          projectnumber: proj,
          description: descMap.get(proj) ?? "",
          projectValue,
          basicHours: totalBasic,
          otHours: totalOT,
          labourCost,
          committed,
          invoiced,
          totalCost: labourCost + committed + invoiced,
          items,
          hasMultipleItems: items.length > 1,
        };
      })
      .filter((r) => r.basicHours > 0 || r.otHours > 0 || r.committed > 0 || r.invoiced > 0 || r.projectValue > 0)
      .sort((a, b) => (parseInt(b.projectnumber) || 0) - (parseInt(a.projectnumber) || 0));

    return rows;
  }, [tsEntries, poData, descMap, itemDescMap, itemValueMap, projectValueMap, basicRate, otMultiplier]);

  const toggleExpand = (proj: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(proj)) next.delete(proj); else next.add(proj);
      return next;
    });
  };

  // Totals
  const totals = useMemo(() => {
    return projectRows.reduce(
      (acc, r) => ({
        projectValue: acc.projectValue + r.projectValue,
        basicHours: acc.basicHours + r.basicHours,
        otHours: acc.otHours + r.otHours,
        labourCost: acc.labourCost + r.labourCost,
        committed: acc.committed + r.committed,
        invoiced: acc.invoiced + r.invoiced,
        totalCost: acc.totalCost + r.totalCost,
      }),
      { projectValue: 0, basicHours: 0, otHours: 0, labourCost: 0, committed: 0, invoiced: 0, totalCost: 0 }
    );
  }, [projectRows]);

  const fmt = (v: number) => (v > 0 ? v.toFixed(2) : "–");
  const fmtCurrency = (v: number) =>
    v > 0 ? `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "–";
  const fmtSignedCurrency = (v: number) => {
    const abs = Math.abs(v);
    const str = `£${abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return v < 0 ? `-${str}` : str;
  };
  // Margin calculations per row
  const marginCalc = (row: { projectValue: number; totalCost: number }) => {
    const targetMarginValue = row.projectValue * (targetMargin / 100);
    const variance = (row.projectValue - row.totalCost) - targetMarginValue;
    return { targetMarginValue, variance };
  };

  // Spend profile chart data for selected project
  const chartData = useMemo(() => {
    if (!selectedProject) return [];

    // Bucket timesheet hours by month for this project
    const monthMap = new Map<string, { labourCost: number; poSpend: number }>();

    for (const e of tsEntries) {
      const proj = e.project_item.replace(/-\d+$/, "");
      if (proj !== selectedProject) continue;
      if (["SHOPWORK-01", "HOLIDAY-01", "TRAINING-01", "SICK-01"].includes(e.project_item)) continue;
      const month = e.work_date?.slice(0, 7); // YYYY-MM
      if (!month) continue;
      if (!monthMap.has(month)) monthMap.set(month, { labourCost: 0, poSpend: 0 });
      const entry = monthMap.get(month)!;
      const hrs = Number(e.hours);
      entry.labourCost += e.is_overtime ? hrs * basicRate * otMultiplier : hrs * basicRate;
    }

    // Bucket PO spend by month for this project
    for (const po of poData) {
      if (po.project_id !== selectedProject) continue;
      const month = po.created_at?.slice(0, 7);
      if (!month) continue;
      if (!monthMap.has(month)) monthMap.set(month, { labourCost: 0, poSpend: 0 });
      monthMap.get(month)!.poSpend += po.total_value;
    }

    // Sort by month and calculate cumulatives
    const sorted = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let cumTotal = 0;
    let cumLabour = 0;
    let cumPO = 0;
    return sorted.map(([month, data]) => {
      cumTotal += data.labourCost + data.poSpend;
      cumLabour += data.labourCost;
      cumPO += data.poSpend;
      const [y, m] = month.split("-");
      const label = new Date(Number(y), Number(m) - 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      return {
        month: label,
        "Labour Cost": Math.round(data.labourCost * 100) / 100,
        "PO Spend": Math.round(data.poSpend * 100) / 100,
        "Cumulative Total": Math.round(cumTotal * 100) / 100,
        "Cumulative Labour": Math.round(cumLabour * 100) / 100,
        "Cumulative PO": Math.round(cumPO * 100) / 100,
      };
    });
  }, [selectedProject, tsEntries, poData, basicRate, otMultiplier]);

  // Excel export
  const exportExcel = () => {
    const NAVY = "061B37";
    const border = {
      top: { style: "thin", color: { rgb: "000000" } },
      bottom: { style: "thin", color: { rgb: "000000" } },
      left: { style: "thin", color: { rgb: "000000" } },
      right: { style: "thin", color: { rgb: "000000" } },
    } as const;
    const hdr = {
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
      fill: { fgColor: { rgb: NAVY } },
      alignment: { horizontal: "center" as const, vertical: "center" as const },
      border,
    };
    const titleS = { font: { bold: true, sz: 14, color: { rgb: NAVY } } };
    const cellT = { font: { sz: 10 }, border, alignment: { vertical: "center" as const } };
    const cellN = { ...cellT, alignment: { horizontal: "right" as const, vertical: "center" as const }, numFmt: "0.00" };
    const cellC = { ...cellT, alignment: { horizontal: "right" as const, vertical: "center" as const }, numFmt: "£#,##0.00" };
    const cellOT = { ...cellN, font: { sz: 10, color: { rgb: "D97706" } } };
    const totS = { ...cellN, font: { sz: 10, bold: true }, fill: { fgColor: { rgb: "F3F4F6" } } };
    const totC = { ...cellC, font: { sz: 10, bold: true }, fill: { fgColor: { rgb: "F3F4F6" } } };
    const totL = { ...cellT, font: { sz: 10, bold: true }, fill: { fgColor: { rgb: "F3F4F6" } }, alignment: { horizontal: "right" as const, vertical: "center" as const } };

    const nc = (v: number, s: object) => v > 0 ? { v, t: "n", s } : { v: "", t: "s", s: cellT };
    const tc = (v: string, s?: object) => ({ v, t: "s", s: s ?? cellT });

    const cellGreen = { ...cellC, font: { sz: 10, color: { rgb: "15803D" } } };
    const cellRed = { ...cellC, font: { sz: 10, color: { rgb: "DC2626" } } };

    const headers = ["Project", "Description", "Project Value (£)", "Basic Hours", "OT Hours", "Labour Cost (£)", "Committed (£)", "Invoiced (£)", "Total Cost (£)", `Target Margin (${targetMargin}%)`, "Variance (£)"];

    const wsRows: object[][] = [
      [{ v: "Project Cost Overview", t: "s", s: titleS }],
      [{ v: `Rate: £${basicRate}/hr | OT: x${otMultiplier} | Target Margin: ${targetMargin}%`, t: "s", s: { font: { sz: 10, color: { rgb: "666666" } } } }],
      headers.map((h) => ({ v: h, t: "s", s: hdr })),
      ...projectRows.map((r) => {
        const m = marginCalc(r);
        return [
          tc(r.projectnumber),
          tc(r.description),
          nc(r.projectValue, cellC),
          nc(r.basicHours, cellN),
          nc(r.otHours, cellOT),
          nc(r.labourCost, cellC),
          nc(r.committed, cellC),
          nc(r.invoiced, cellC),
          nc(r.totalCost, cellC),
          r.projectValue > 0 ? { v: m.targetMarginValue, t: "n", s: cellC } : { v: "", t: "s", s: cellT },
          r.projectValue > 0 ? { v: m.variance, t: "n", s: m.variance >= 0 ? cellGreen : cellRed } : { v: "", t: "s", s: cellT },
        ];
      }),
      [],
      [
        tc("Totals", totL), tc("", totS),
        { v: totals.projectValue, t: "n", s: totC },
        { v: totals.basicHours, t: "n", s: totS },
        { v: totals.otHours, t: "n", s: { ...totS, font: { sz: 10, bold: true, color: { rgb: "D97706" } } } },
        { v: totals.labourCost, t: "n", s: totC },
        { v: totals.committed, t: "n", s: totC },
        { v: totals.invoiced, t: "n", s: totC },
        { v: totals.totalCost, t: "n", s: totC },
        (() => { const m = marginCalc(totals); return { v: m.targetMarginValue, t: "n", s: totC }; })(),
        (() => { const m = marginCalc(totals); return { v: m.variance, t: "n", s: { ...totC, font: { sz: 10, bold: true, color: { rgb: m.variance >= 0 ? "15803D" : "DC2626" } } } }; })(),
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsRows);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
    ];
    ws["!cols"] = [
      { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
      { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
      { wch: 16 }, { wch: 16 },
    ];
    ws["!rows"] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 22 }];

    const wb = XLSX.utils.book_new();
    const now = new Date();
    const dateStr = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    XLSX.utils.book_append_sheet(wb, ws, "Cost Overview");
    XLSX.writeFile(wb, `project-costs-${dateStr}.xlsx`);
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Project Cost Overview</h1>
        <p className="text-gray-600">Sign in to view operations data</p>
        <AuthButton redirectTo="/operations/" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 max-w-full mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Project Cost Overview</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportExcel}
            disabled={projectRows.length === 0}
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
            <label className="text-sm font-medium">Basic rate (£/hr):</label>
            <input
              type="number"
              value={basicRate}
              onChange={(e) => setBasicRate(Number(e.target.value) || 49)}
              className="w-20 rounded border px-2 py-1 text-sm text-center"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">OT multiplier:</label>
            <input
              type="number"
              step="0.1"
              value={otMultiplier}
              onChange={(e) => setOtMultiplier(Number(e.target.value) || 1.5)}
              className="w-20 rounded border px-2 py-1 text-sm text-center"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Target margin (%):</label>
            <input
              type="number"
              step="1"
              value={targetMargin}
              onChange={(e) => setTargetMargin(Number(e.target.value) || 30)}
              className="w-20 rounded border px-2 py-1 text-sm text-center"
            />
          </div>
          <div className="text-xs text-gray-500">
            Labour cost = (basic hrs × £{basicRate}) + (OT hrs × £{basicRate} × {otMultiplier})
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 py-4">Loading project data...</div>
      ) : projectRows.length === 0 ? (
        <div className="text-gray-500 py-8 text-center border rounded">
          No project data found
        </div>
      ) : (
        <div className="overflow-auto border rounded" style={{ maxHeight: "calc(100vh - 200px)" }}>
          <table className="border-collapse text-sm w-full">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-50">
                <th className="border px-3 py-2 text-left sticky left-0 bg-gray-50 z-30 min-w-28">Project</th>
                <th className="border px-3 py-2 text-left min-w-48">Description</th>
                <th className="border px-3 py-2 text-right min-w-28">Project Value</th>
                <th className="border px-3 py-2 text-right min-w-24">Basic Hours</th>
                <th className="border px-3 py-2 text-right min-w-20">OT Hours</th>
                <th className="border px-3 py-2 text-right min-w-28">Labour Cost</th>
                <th className="border px-3 py-2 text-right min-w-28">Committed</th>
                <th className="border px-3 py-2 text-right min-w-28">Invoiced</th>
                <th className="border px-3 py-2 text-right min-w-28">Total Cost</th>
                <th className="border px-3 py-2 text-right min-w-28">Target Margin</th>
                <th className="border px-3 py-2 text-right min-w-28">Variance</th>
              </tr>
            </thead>
            <tbody>
              {projectRows.map((row) => {
                const isExpanded = expanded.has(row.projectnumber);
                return (
                  <Fragment key={row.projectnumber}>
                    <tr
                      className={`hover:bg-gray-50 cursor-pointer ${row.hasMultipleItems ? "font-medium" : ""} ${selectedProject === row.projectnumber ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""}`}
                      onClick={() => setSelectedProject(selectedProject === row.projectnumber ? null : row.projectnumber)}
                    >
                      <td className={`border px-3 py-1.5 font-mono text-xs font-medium sticky left-0 z-10 ${selectedProject === row.projectnumber ? "bg-blue-50" : "bg-white"}`}>
                        <div className="flex items-center gap-1">
                          {row.hasMultipleItems && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleExpand(row.projectnumber); }}
                              className="text-gray-400 hover:text-gray-600 cursor-pointer w-4"
                            >
                              {isExpanded ? "▼" : "▶"}
                            </button>
                          )}
                          {row.projectnumber}
                        </div>
                      </td>
                      <td className="border px-3 py-1.5 text-xs text-gray-600 truncate max-w-64">
                        {row.description || "–"}
                      </td>
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.projectValue)}</td>
                      <td className="border px-3 py-1.5 text-right">
                        {row.basicHours > 0 ? (
                          <a href={`/timesheets/reports/?highlight=${row.projectnumber}`} className="text-blue-600 hover:underline">{fmt(row.basicHours)}</a>
                        ) : "–"}
                      </td>
                      <td className="border px-3 py-1.5 text-right">
                        {row.otHours > 0 ? (
                          <a href={`/timesheets/reports/?highlight=${row.projectnumber}`} className="text-amber-600 font-medium hover:underline">{row.otHours.toFixed(2)}</a>
                        ) : "–"}
                      </td>
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.labourCost)}</td>
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.committed)}</td>
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.invoiced)}</td>
                      <td className="border px-3 py-1.5 text-right font-medium">{fmtCurrency(row.totalCost)}</td>
                      {(() => {
                        const m = marginCalc(row);
                        return (
                          <>
                            <td className="border px-3 py-1.5 text-right">{row.projectValue > 0 ? fmtCurrency(m.targetMarginValue) : "–"}</td>
                            <td className={`border px-3 py-1.5 text-right font-medium ${row.projectValue > 0 ? (m.variance >= 0 ? "text-green-700" : "text-red-600") : ""}`}>
                              {row.projectValue > 0 ? fmtSignedCurrency(m.variance) : "–"}
                            </td>
                          </>
                        );
                      })()}
                    </tr>
                    {row.hasMultipleItems && isExpanded && row.items.map((item) => (
                      <tr key={item.project_item} className="hover:bg-gray-50 text-gray-600">
                        <td className="border px-3 py-1 font-mono text-xs sticky left-0 bg-white z-10 pl-8">
                          {item.project_item}
                        </td>
                        <td className="border px-3 py-1 text-xs text-gray-400 truncate max-w-64">
                          {item.description || "–"}
                        </td>
                        <td className="border px-3 py-1 text-right text-xs">{fmtCurrency(item.projectValue)}</td>
                        <td className="border px-3 py-1 text-right text-xs">{fmt(item.basicHours)}</td>
                        <td className="border px-3 py-1 text-right text-xs">
                          {item.otHours > 0 ? <span className="text-amber-600">{item.otHours.toFixed(2)}</span> : "–"}
                        </td>
                        <td className="border px-3 py-1 text-right text-xs">{fmtCurrency(item.labourCost)}</td>
                        <td className="border px-3 py-1 text-right text-xs">–</td>
                        <td className="border px-3 py-1 text-right text-xs">–</td>
                        <td className="border px-3 py-1 text-right text-xs">{fmtCurrency(item.totalCost)}</td>
                        <td className="border px-3 py-1 text-right text-xs">–</td>
                        <td className="border px-3 py-1 text-right text-xs">–</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}

              {/* Totals row */}
              <tr className="bg-gray-50 font-medium sticky bottom-0 z-20">
                <td className="border px-3 py-2 text-right sticky left-0 bg-gray-50 z-30" colSpan={2}>
                  Totals
                </td>
                <td className="border px-3 py-2 text-right font-bold">{fmtCurrency(totals.projectValue)}</td>
                <td className="border px-3 py-2 text-right">{fmt(totals.basicHours)}</td>
                <td className="border px-3 py-2 text-right">
                  <span className="text-amber-600">{totals.otHours.toFixed(2)}</span>
                </td>
                <td className="border px-3 py-2 text-right">{fmtCurrency(totals.labourCost)}</td>
                <td className="border px-3 py-2 text-right">{fmtCurrency(totals.committed)}</td>
                <td className="border px-3 py-2 text-right">{fmtCurrency(totals.invoiced)}</td>
                <td className="border px-3 py-2 text-right font-bold">{fmtCurrency(totals.totalCost)}</td>
                {(() => {
                  const m = marginCalc(totals);
                  return (
                    <>
                      <td className="border px-3 py-2 text-right bg-gray-50">{fmtCurrency(m.targetMarginValue)}</td>
                      <td className={`border px-3 py-2 text-right font-bold bg-gray-50 ${m.variance >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {fmtSignedCurrency(m.variance)}
                      </td>
                    </>
                  );
                })()}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Spend profile chart for selected project */}
      {selectedProject && chartData.length > 0 && (
        <div className="mt-6 border rounded p-4 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Spend Profile — {selectedProject} ({descMap.get(selectedProject) || ""})
            </h2>
            <button
              type="button"
              onClick={() => setSelectedProject(null)}
              className="text-gray-400 hover:text-gray-600 text-xl cursor-pointer"
            >
              ✕
            </button>
          </div>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(value: number, name: string) =>
                  [`£${value.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, name]
                }
              />
              <Legend
                onClick={(e: { dataKey?: string }) => {
                  if (!e.dataKey) return;
                  setHiddenSeries((prev) => {
                    const next = new Set(prev);
                    if (next.has(e.dataKey!)) next.delete(e.dataKey!); else next.add(e.dataKey!);
                    return next;
                  });
                }}
                formatter={(value: string) => (
                  <span style={{ color: hiddenSeries.has(value) ? "#ccc" : undefined, cursor: "pointer" }}>{value}</span>
                )}
              />
              <Bar yAxisId="left" dataKey="Labour Cost" stackId="spend" fill="#061b37" hide={hiddenSeries.has("Labour Cost")} />
              <Bar yAxisId="left" dataKey="PO Spend" stackId="spend" fill="#97caeb" hide={hiddenSeries.has("PO Spend")} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Cumulative Total"
                stroke="#dc2626"
                strokeWidth={2}
                dot={{ r: 3 }}
                hide={hiddenSeries.has("Cumulative Total")}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Cumulative Labour"
                stroke="#061b37"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={{ r: 2 }}
                hide={hiddenSeries.has("Cumulative Labour")}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Cumulative PO"
                stroke="#97caeb"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={{ r: 2 }}
                hide={hiddenSeries.has("Cumulative PO")}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {selectedProject && chartData.length === 0 && (
        <div className="mt-6 border rounded p-4 bg-white text-center text-gray-500">
          No spend data available for {selectedProject}
        </div>
      )}
    </div>
  );
}
