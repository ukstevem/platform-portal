"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
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

type POLineItem = {
  project_id: string;
  total: number;
  invoice_reference: string | null;
  created_at: string;
  exped_completed_date: string | null;
  category: "committed" | "received" | "invoiced";
};

type ItemRow = {
  project_item: string;
  description: string;
  projectValue: number;
  estLabour: number;
  estMaterials: number;
  pctComplete: number;
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
  estLabour: number;
  estMaterials: number;
  basicHours: number;
  otHours: number;
  labourCost: number;
  committed: number;
  received: number;
  invoiced: number;
  totalCost: number;
  estTotalCost: number;
  pctComplete: number;
  labourVariance: number;
  materialsVariance: number;
  plannedMargin: number;
  currentMargin: number;
  marginPosition: number; // percentage
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
  const [estLabourMap, setEstLabourMap] = useState<Map<string, number>>(new Map());
  const [estMaterialsMap, setEstMaterialsMap] = useState<Map<string, number>>(new Map());
  const [itemIdMap, setItemIdMap] = useState<Map<string, string>>(new Map()); // "10312-01" → uuid
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Configurable rates
  const [basicRate, setBasicRate] = useState(49);
  const [otMultiplier, setOtMultiplier] = useState(1.5);
  const [showSettings, setShowSettings] = useState(false);
  const [projectFilter, setProjectFilter] = useState<"live" | "completed" | "all">("live");
  const [completedMap, setCompletedMap] = useState<Map<string, boolean>>(new Map());
  const [pctCompleteMap, setPctCompleteMap] = useState<Map<string, number>>(new Map());

  // Load all data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const pageSize = 1000;

      // Timesheet entries — paginated
      let allTs: TimesheetEntry[] = [];
      let from = 0;
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

      // PO line items via purchase_orders join — paginated
      let allPo: POLineItem[] = [];
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("po_line_items")
          .select("total, active, exped_completed_date, purchase_orders!inner(project_id, created_at, invoice_reference)")
          .eq("active", true)
          .range(from, from + pageSize - 1);
        if (cancelled) return;
        if (!data || data.length === 0) break;
        for (const d of data) {
          const po = (d as any).purchase_orders;
          if (!po?.project_id) continue;
          const hasInvoice = !!po.invoice_reference;
          const hasReceived = !!d.exped_completed_date;
          allPo.push({
            project_id: po.project_id,
            total: Number(d.total) || 0,
            invoice_reference: po.invoice_reference,
            created_at: po.created_at ?? "",
            exped_completed_date: d.exped_completed_date,
            category: hasInvoice ? "invoiced" : hasReceived ? "received" : "committed",
          });
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Project descriptions, values, estimates, and IDs
      const m = new Map<string, string>();
      const iDescMap = new Map<string, string>();
      const iValMap = new Map<string, number>();
      const valMap = new Map<string, number>();
      const idMap = new Map<string, string>();
      const eLab = new Map<string, number>();
      const eMat = new Map<string, number>();
      const compMap = new Map<string, boolean>(); // projectnumber → completed (true if ALL items completed)
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_register_items")
          .select("id, projectnumber, item_seq, line_desc, value, est_labour, est_materials, completed")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          const itemKey = `${r.projectnumber}-${String(r.item_seq).padStart(2, "0")}`;
          const itemKey01 = `${r.projectnumber}-01`;
          if (!m.has(r.projectnumber) || itemKey === itemKey01) m.set(r.projectnumber, r.line_desc);
          iDescMap.set(itemKey, r.line_desc);
          iValMap.set(itemKey, Number(r.value) || 0);
          valMap.set(r.projectnumber, (valMap.get(r.projectnumber) ?? 0) + (Number(r.value) || 0));
          idMap.set(itemKey, r.id);
          eLab.set(itemKey, Number(r.est_labour) || 0);
          eMat.set(itemKey, Number(r.est_materials) || 0);
          // A project is completed only if ALL its items are completed
          const wasCompleted = compMap.get(r.projectnumber);
          if (wasCompleted === undefined) {
            compMap.set(r.projectnumber, !!r.completed);
          } else if (!r.completed) {
            compMap.set(r.projectnumber, false);
          }
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
      setEstLabourMap(eLab);
      setEstMaterialsMap(eMat);
      setItemIdMap(idMap);
      setCompletedMap(compMap);

      // Fetch commercial data (% complete per item, keyed by "10300-01")
      const pctMap = new Map<string, number>();
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_items_commercial")
          .select("projectnumber, item_seq, pct_complete")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          const key = `${r.projectnumber}-${String(r.item_seq).padStart(2, "0")}`;
          pctMap.set(key, r.pct_complete ?? 0);
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      if (cancelled) return;
      setPctCompleteMap(pctMap);

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Save estimate to DB (updates project_register_items directly)
  const saveEstimate = useCallback(async (projectnumber: string, item_seq: number, field: "est_labour" | "est_materials", value: number) => {
    const key = `${projectnumber}-${String(item_seq).padStart(2, "0")}`;
    const id = itemIdMap.get(key);
    if (!id) return;

    if (field === "est_labour") {
      setEstLabourMap((prev) => { const next = new Map(prev); next.set(key, value); return next; });
    } else {
      setEstMaterialsMap((prev) => { const next = new Map(prev); next.set(key, value); return next; });
    }

    await supabase.from("project_register_items").update({ [field]: value }).eq("id", id);
  }, [itemIdMap]);

  // Save % complete to project_items_commercial (upsert per item)
  const savePctComplete = useCallback(async (projectnumber: string, item_seq: number, value: number) => {
    const key = `${projectnumber}-${String(item_seq).padStart(2, "0")}`;
    const project_item_id = itemIdMap.get(key);
    if (!project_item_id) {
      console.warn("No project_item_id found for", key);
      return;
    }
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    setPctCompleteMap((prev) => { const next = new Map(prev); next.set(key, clamped); return next; });
    const { error } = await supabase.from("project_items_commercial").upsert(
      { project_item_id, projectnumber, item_seq, pct_complete: clamped },
      { onConflict: "projectnumber,item_seq" }
    );
    if (error) console.error("Failed to save % complete:", error);
  }, [itemIdMap]);

  // Toggle project completed status
  const toggleCompleted = useCallback(async (projectnumber: string) => {
    const isCompleted = completedMap.get(projectnumber) ?? false;
    const newStatus = !isCompleted;
    const completedAt = newStatus ? new Date().toISOString() : null;

    // Update all items for this project
    await supabase
      .from("project_register_items")
      .update({ completed: newStatus, completed_at: completedAt })
      .eq("projectnumber", projectnumber);

    setCompletedMap((prev) => {
      const next = new Map(prev);
      next.set(projectnumber, newStatus);
      return next;
    });
  }, [completedMap]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; projectnumber: string } | null>(null);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // Build project rows with sub-items
  const projectRows = useMemo<ProjectRow[]>(() => {
    const itemHoursMap = new Map<string, { basic: number; ot: number }>();
    for (const e of tsEntries) {
      if (["SHOPWORK-01", "HOLIDAY-01", "TRAINING-01", "SICK-01"].includes(e.project_item)) continue;
      if (!itemHoursMap.has(e.project_item)) itemHoursMap.set(e.project_item, { basic: 0, ot: 0 });
      const entry = itemHoursMap.get(e.project_item)!;
      const hrs = Number(e.hours);
      if (e.is_overtime) { entry.ot += hrs; } else { entry.basic += hrs; }
    }

    const committedMap = new Map<string, number>();
    const receivedMap = new Map<string, number>();
    const invoicedMap = new Map<string, number>();
    for (const po of poData) {
      const proj = po.project_id;
      if (po.category === "invoiced") {
        invoicedMap.set(proj, (invoicedMap.get(proj) ?? 0) + po.total);
      } else if (po.category === "received") {
        receivedMap.set(proj, (receivedMap.get(proj) ?? 0) + po.total);
      } else {
        committedMap.set(proj, (committedMap.get(proj) ?? 0) + po.total);
      }
    }

    const allItemKeys = new Set([...itemHoursMap.keys(), ...itemValueMap.keys()]);
    const projItemsMap = new Map<string, Set<string>>();
    for (const itemKey of allItemKeys) {
      const dashIdx = itemKey.lastIndexOf("-");
      const proj = dashIdx > 0 ? itemKey.substring(0, dashIdx) : itemKey;
      if (!projItemsMap.has(proj)) projItemsMap.set(proj, new Set());
      projItemsMap.get(proj)!.add(itemKey);
    }

    const allProjects = new Set([
      ...projItemsMap.keys(),
      ...committedMap.keys(),
      ...receivedMap.keys(),
      ...invoicedMap.keys(),
      ...projectValueMap.keys(),
    ]);

    const rows: ProjectRow[] = Array.from(allProjects)
      .map((proj) => {
        const committed = committedMap.get(proj) ?? 0;
        const received = receivedMap.get(proj) ?? 0;
        const invoiced = invoicedMap.get(proj) ?? 0;
        const projectValue = projectValueMap.get(proj) ?? 0;

        const itemKeys = Array.from(projItemsMap.get(proj) ?? []).sort();
        const items: ItemRow[] = itemKeys.map((itemKey) => {
          const hrs = itemHoursMap.get(itemKey) ?? { basic: 0, ot: 0 };
          const val = itemValueMap.get(itemKey) ?? 0;
          const lc = hrs.basic * basicRate + hrs.ot * basicRate * otMultiplier;
          return {
            project_item: itemKey,
            description: itemDescMap.get(itemKey) ?? "",
            projectValue: val,
            estLabour: estLabourMap.get(itemKey) ?? 0,
            estMaterials: estMaterialsMap.get(itemKey) ?? 0,
            pctComplete: pctCompleteMap.get(itemKey) ?? 0,
            basicHours: hrs.basic,
            otHours: hrs.ot,
            labourCost: lc,
            committed: 0,
            invoiced: 0,
            totalCost: lc,
          };
        });

        const totalBasic = items.reduce((s, i) => s + i.basicHours, 0);
        const totalOT = items.reduce((s, i) => s + i.otHours, 0);
        const labourCost = totalBasic * basicRate + totalOT * basicRate * otMultiplier;
        const estLabour = items.reduce((s, i) => s + i.estLabour, 0);
        const estMaterials = items.reduce((s, i) => s + i.estMaterials, 0);
        const actualMaterials = committed + received + invoiced;
        const totalCost = labourCost + actualMaterials;

        return {
          projectnumber: proj,
          description: descMap.get(proj) ?? "",
          projectValue,
          estLabour,
          estMaterials,
          basicHours: totalBasic,
          otHours: totalOT,
          labourCost,
          committed,
          received,
          invoiced,
          totalCost,
          estTotalCost: estLabour + estMaterials,
          pctComplete: (() => {
            // Weighted average of item % complete, weighted by est cost per item
            const totalEstCost = items.reduce((s, i) => s + i.estLabour + i.estMaterials, 0);
            if (totalEstCost === 0) return items.length > 0 ? Math.round(items.reduce((s, i) => s + i.pctComplete, 0) / items.length) : 0;
            return Math.round(items.reduce((s, i) => s + i.pctComplete * (i.estLabour + i.estMaterials), 0) / totalEstCost);
          })(),
          labourVariance: estLabour - labourCost,
          materialsVariance: estMaterials - actualMaterials,
          plannedMargin: projectValue - (estLabour + estMaterials),
          currentMargin: (projectValue - (estLabour + estMaterials)) + (estLabour - labourCost) + (estMaterials - actualMaterials),
          marginPosition: (() => {
            const pm = projectValue - (estLabour + estMaterials);
            if ((estLabour + estMaterials) === 0 || pm === 0) return 0;
            return (((estLabour - labourCost) + (estMaterials - actualMaterials)) / pm) * 100;
          })(),
          items,
          hasMultipleItems: items.length > 1,
        };
      })
      .filter((r) => r.basicHours > 0 || r.otHours > 0 || r.committed > 0 || r.received > 0 || r.invoiced > 0 || r.projectValue > 0)
      .filter((r) => {
        const isCompleted = completedMap.get(r.projectnumber) ?? false;
        if (projectFilter === "live") return !isCompleted;
        if (projectFilter === "completed") return isCompleted;
        return true;
      })
      .sort((a, b) => (parseInt(b.projectnumber) || 0) - (parseInt(a.projectnumber) || 0));

    return rows;
  }, [tsEntries, poData, descMap, itemDescMap, itemValueMap, projectValueMap, estLabourMap, estMaterialsMap, pctCompleteMap, completedMap, projectFilter, basicRate, otMultiplier]);

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
        estLabour: acc.estLabour + r.estLabour,
        estMaterials: acc.estMaterials + r.estMaterials,
        basicHours: acc.basicHours + r.basicHours,
        otHours: acc.otHours + r.otHours,
        labourCost: acc.labourCost + r.labourCost,
        committed: acc.committed + r.committed,
        received: acc.received + r.received,
        invoiced: acc.invoiced + r.invoiced,
        totalCost: acc.totalCost + r.totalCost,
        estTotalCost: acc.estTotalCost + r.estTotalCost,
        labourVariance: acc.labourVariance + r.labourVariance,
        materialsVariance: acc.materialsVariance + r.materialsVariance,
        plannedMargin: acc.plannedMargin + r.plannedMargin,
        currentMargin: acc.currentMargin + r.currentMargin,
      }),
      { projectValue: 0, estLabour: 0, estMaterials: 0, basicHours: 0, otHours: 0, labourCost: 0, committed: 0, received: 0, invoiced: 0, totalCost: 0, estTotalCost: 0, labourVariance: 0, materialsVariance: 0, plannedMargin: 0, currentMargin: 0 }
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

  // Editable % complete cell component
  const PctCell = ({ projectnumber, itemSeq, value }: { projectnumber: string; itemSeq: number; value: number }) => {
    const [editing, setEditing] = useState(false);
    const [inputVal, setInputVal] = useState(String(value || ""));

    if (editing) {
      return (
        <input
          type="number"
          min="0"
          max="100"
          autoFocus
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={() => {
            setEditing(false);
            savePctComplete(projectnumber, itemSeq, parseFloat(inputVal) || 0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-full text-right text-sm border rounded px-1 py-0.5"
        />
      );
    }
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); setInputVal(String(value || "")); }}
        className="cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded block text-right"
        title="Click to edit"
      >
        {value > 0 ? `${value}%` : <span className="text-gray-300">set %</span>}
      </span>
    );
  };

  // Editable estimate cell component
  const EstCell = ({ projectnumber, itemSeq, field, value }: { projectnumber: string; itemSeq: number; field: "est_labour" | "est_materials"; value: number }) => {
    const [editing, setEditing] = useState(false);
    const [inputVal, setInputVal] = useState(String(value || ""));

    if (editing) {
      return (
        <input
          type="number"
          step="0.01"
          autoFocus
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={() => {
            setEditing(false);
            const num = parseFloat(inputVal) || 0;
            saveEstimate(projectnumber, itemSeq, field, num);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-full text-right text-sm border rounded px-1 py-0.5"
        />
      );
    }
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); setInputVal(String(value || "")); }}
        className="cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded block text-right"
        title="Click to edit"
      >
        {value > 0 ? fmtCurrency(value) : <span className="text-gray-300">click to set</span>}
      </span>
    );
  };

  // Spend profile chart data
  const chartData = useMemo(() => {
    if (!selectedProject) return [];

    const monthMap = new Map<string, { labourCost: number; committed: number; received: number; invoiced: number }>();
    const empty = () => ({ labourCost: 0, committed: 0, received: 0, invoiced: 0 });

    for (const e of tsEntries) {
      const proj = e.project_item.replace(/-\d+$/, "");
      if (proj !== selectedProject) continue;
      if (["SHOPWORK-01", "HOLIDAY-01", "TRAINING-01", "SICK-01"].includes(e.project_item)) continue;
      const month = e.work_date?.slice(0, 7);
      if (!month) continue;
      if (!monthMap.has(month)) monthMap.set(month, empty());
      const hrs = Number(e.hours);
      monthMap.get(month)!.labourCost += e.is_overtime ? hrs * basicRate * otMultiplier : hrs * basicRate;
    }

    for (const po of poData) {
      if (po.project_id !== selectedProject) continue;
      // Use best available date: received date for received items, created_at for others
      const dateStr = (po.category === "received" && po.exped_completed_date) ? po.exped_completed_date : po.created_at;
      const month = dateStr?.slice(0, 7);
      if (!month) continue;
      if (!monthMap.has(month)) monthMap.set(month, empty());
      const entry = monthMap.get(month)!;
      if (po.category === "invoiced") entry.invoiced += po.total;
      else if (po.category === "received") entry.received += po.total;
      else entry.committed += po.total;
    }

    const sorted = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let cumTotal = 0;
    let cumLabour = 0;
    let cumPO = 0;
    return sorted.map(([month, data]) => {
      const poTotal = data.committed + data.received + data.invoiced;
      cumTotal += data.labourCost + poTotal;
      cumLabour += data.labourCost;
      cumPO += poTotal;
      const [y, m] = month.split("-");
      const label = new Date(Number(y), Number(m) - 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      return {
        month: label,
        "Labour": Math.round(data.labourCost * 100) / 100,
        "Committed": Math.round(data.committed * 100) / 100,
        "Received": Math.round(data.received * 100) / 100,
        "Invoice Cleared": Math.round(data.invoiced * 100) / 100,
        "Cumulative Total": Math.round(cumTotal * 100) / 100,
        "Cumulative Labour": Math.round(cumLabour * 100) / 100,
        "Cumulative Materials": Math.round(cumPO * 100) / 100,
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
    const cellGreen = { ...cellC, font: { sz: 10, color: { rgb: "15803D" } } };
    const cellRed = { ...cellC, font: { sz: 10, color: { rgb: "DC2626" } } };
    const totS = { ...cellN, font: { sz: 10, bold: true }, fill: { fgColor: { rgb: "F3F4F6" } } };
    const totC = { ...cellC, font: { sz: 10, bold: true }, fill: { fgColor: { rgb: "F3F4F6" } } };
    const totL = { ...cellT, font: { sz: 10, bold: true }, fill: { fgColor: { rgb: "F3F4F6" } }, alignment: { horizontal: "right" as const, vertical: "center" as const } };

    const nc = (v: number, s: object) => v > 0 ? { v, t: "n", s } : { v: "", t: "s", s: cellT };
    const tc = (v: string, s?: object) => ({ v, t: "s", s: s ?? cellT });
    const vc = (v: number) => ({ v, t: "n", s: v >= 0 ? cellGreen : cellRed });

    const headers = [
      "Project", "Description", "Contract Value (£)",
      "Est. Total Cost (£)", "Current Cost (£)", "% Complete",
      "Current Margin (£)", "Position %",
      "Est. Labour (£)", "Est. Materials (£)",
      "Basic Hours", "OT Hours", "Current Labour (£)",
      "Committed (£)", "Received (£)", "Invoice Cleared (£)",
      "Labour Var. (£)", "Materials Var. (£)", "Planned Margin (£)",
    ];

    const wsRows: object[][] = [
      [{ v: "Project Cost Overview", t: "s", s: titleS }],
      [{ v: `Rate: £${basicRate}/hr | OT: x${otMultiplier} | Filter: ${projectFilter === "live" ? "Live Projects" : projectFilter === "completed" ? "Completed Projects" : "All Projects"}`, t: "s", s: { font: { sz: 10, color: { rgb: "666666" } } } }],
      headers.map((h) => ({ v: h, t: "s", s: hdr })),
      ...projectRows.map((r) => [
        tc(r.projectnumber),
        tc(r.description),
        nc(r.projectValue, cellC),
        // Summary
        nc(r.estTotalCost, cellC),
        nc(r.totalCost, cellC),
        r.pctComplete > 0 ? { v: r.pctComplete / 100, t: "n", s: { ...cellN, numFmt: "0%" } } : { v: "", t: "s", s: cellT },
        r.projectValue > 0 && r.estTotalCost > 0 ? vc(r.currentMargin) : { v: "", t: "s", s: cellT },
        r.projectValue > 0 && r.estTotalCost > 0 ? { v: r.marginPosition / 100, t: "n", s: { ...cellN, numFmt: "+0.0%;-0.0%", font: { sz: 10, color: { rgb: r.marginPosition >= 0 ? "15803D" : "DC2626" } } } } : { v: "", t: "s", s: cellT },
        // Detail
        nc(r.estLabour, cellC),
        nc(r.estMaterials, cellC),
        nc(r.basicHours, cellN),
        nc(r.otHours, cellOT),
        nc(r.labourCost, cellC),
        nc(r.committed, cellC),
        nc(r.received, cellC),
        nc(r.invoiced, cellC),
        r.estLabour > 0 ? vc(r.labourVariance) : { v: "", t: "s", s: cellT },
        r.estMaterials > 0 ? vc(r.materialsVariance) : { v: "", t: "s", s: cellT },
        r.projectValue > 0 && r.estTotalCost > 0 ? vc(r.plannedMargin) : { v: "", t: "s", s: cellT },
      ]),
      [],
      [
        tc("Totals", totL), tc("", totS),
        { v: totals.projectValue, t: "n", s: totC },
        // Summary
        { v: totals.estTotalCost, t: "n", s: totC },
        { v: totals.totalCost, t: "n", s: totC },
        { v: "", t: "s", s: totS },
        { v: totals.currentMargin, t: "n", s: { ...totC, font: { sz: 10, bold: true, color: { rgb: totals.currentMargin >= 0 ? "15803D" : "DC2626" } } } },
        { v: "", t: "s", s: totS },
        // Detail
        { v: totals.estLabour, t: "n", s: totC },
        { v: totals.estMaterials, t: "n", s: totC },
        { v: totals.basicHours, t: "n", s: totS },
        { v: totals.otHours, t: "n", s: { ...totS, font: { sz: 10, bold: true, color: { rgb: "D97706" } } } },
        { v: totals.labourCost, t: "n", s: totC },
        { v: totals.committed, t: "n", s: totC },
        { v: totals.received, t: "n", s: totC },
        { v: totals.invoiced, t: "n", s: totC },
        { v: "", t: "s", s: totS },
        { v: "", t: "s", s: totS },
        { v: "", t: "s", s: totS },
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsRows);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 18 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 18 } },
    ];
    ws["!cols"] = [
      { wch: 14 }, { wch: 30 }, { wch: 16 },
      { wch: 16 }, { wch: 16 }, { wch: 12 },
      { wch: 16 }, { wch: 12 },
      { wch: 16 }, { wch: 16 },
      { wch: 14 }, { wch: 12 }, { wch: 16 },
      { wch: 16 }, { wch: 16 }, { wch: 20 },
      { wch: 16 }, { wch: 16 }, { wch: 16 },
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
          <div className="flex rounded border overflow-hidden">
            {(["live", "completed", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setProjectFilter(f)}
                className={`px-3 py-1 text-sm cursor-pointer ${projectFilter === f ? "bg-[#061b37] text-white" : "hover:bg-gray-100"}`}
              >
                {f === "live" ? "Live" : f === "completed" ? "Completed" : "All"}
              </button>
            ))}
          </div>
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
                {/* Summary columns — visible on initial view */}
                <th className="border px-3 py-2 text-left sticky left-0 bg-gray-50 z-30 min-w-28">Project</th>
                <th className="border px-3 py-2 text-left sticky left-28 bg-gray-50 z-30 min-w-48">Description</th>
                <th className="border px-3 py-2 text-right min-w-28">Contract Value</th>
                <th className="border px-3 py-2 text-right min-w-28">Est. Total Cost</th>
                <th className="border px-3 py-2 text-right min-w-28">Current Cost</th>
                <th className="border px-3 py-2 text-right min-w-20">% Complete</th>
                <th className="border px-3 py-2 text-right min-w-28">Current Margin</th>
                <th className="border px-3 py-2 text-right min-w-24">Position %</th>
                {/* Detail columns — scroll right */}
                <th className="border px-3 py-2 text-right min-w-28 bg-blue-50">Est. Labour</th>
                <th className="border px-3 py-2 text-right min-w-28 bg-blue-50">Est. Materials</th>
                <th className="border px-3 py-2 text-right min-w-24">Basic Hours</th>
                <th className="border px-3 py-2 text-right min-w-20">OT Hours</th>
                <th className="border px-3 py-2 text-right min-w-28">Current Labour</th>
                <th className="border px-3 py-2 text-right min-w-28">Committed</th>
                <th className="border px-3 py-2 text-right min-w-28">Received</th>
                <th className="border px-3 py-2 text-right min-w-28">Invoice Cleared</th>
                <th className="border px-3 py-2 text-right min-w-28">Labour Var.</th>
                <th className="border px-3 py-2 text-right min-w-28">Materials Var.</th>
                <th className="border px-3 py-2 text-right min-w-28">Planned Margin</th>
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
                      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, projectnumber: row.projectnumber }); }}
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
                          <a href={`/operations/projects/${row.projectnumber}`} onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-blue-600">{row.projectnumber}</a>
                        </div>
                      </td>
                      <td className={`border px-3 py-1.5 text-xs text-gray-600 truncate max-w-64 sticky left-28 z-10 ${selectedProject === row.projectnumber ? "bg-blue-50" : "bg-white"}`}>
                        {row.description || "–"}
                      </td>
                      {/* Summary columns */}
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.projectValue)}</td>
                      <td className="border px-3 py-1.5 text-right">
                        {row.estTotalCost > 0 ? fmtCurrency(row.estTotalCost) : row.projectValue > 0 ? <span className="text-amber-500 text-xs italic">estimates needed</span> : "–"}
                      </td>
                      <td className="border px-3 py-1.5 text-right font-medium">{fmtCurrency(row.totalCost)}</td>
                      <td className="border px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                        {row.hasMultipleItems
                          ? (row.pctComplete > 0 ? `${row.pctComplete}%` : <span className="text-gray-300 text-xs">set per item</span>)
                          : <PctCell projectnumber={row.projectnumber} itemSeq={parseInt(row.items[0]?.project_item?.split("-").pop() || "1")} value={row.pctComplete} />
                        }
                      </td>
                      <td className={`border px-3 py-1.5 text-right font-medium ${row.projectValue > 0 && row.estTotalCost > 0 ? (row.currentMargin >= 0 ? "text-green-700" : "text-red-600") : ""}`}>
                        {row.projectValue > 0 && row.estTotalCost > 0 ? fmtSignedCurrency(row.currentMargin) : "–"}
                      </td>
                      <td className={`border px-3 py-1.5 text-right font-medium ${row.projectValue > 0 && row.estTotalCost > 0 ? (row.marginPosition >= 0 ? "text-green-700" : "text-red-600") : ""}`}>
                        {row.projectValue > 0 && row.estTotalCost > 0 ? `${row.marginPosition >= 0 ? "+" : ""}${row.marginPosition.toFixed(1)}%` : "–"}
                      </td>
                      {/* Detail columns */}
                      <td className="border px-3 py-1.5 bg-blue-50/30" onClick={(e) => e.stopPropagation()}>
                        {row.hasMultipleItems
                          ? fmtCurrency(row.estLabour)
                          : <EstCell projectnumber={row.projectnumber} itemSeq={parseInt(row.items[0]?.project_item?.split("-").pop() || "1")} field="est_labour" value={row.estLabour} />
                        }
                      </td>
                      <td className="border px-3 py-1.5 bg-blue-50/30" onClick={(e) => e.stopPropagation()}>
                        {row.hasMultipleItems
                          ? fmtCurrency(row.estMaterials)
                          : <EstCell projectnumber={row.projectnumber} itemSeq={parseInt(row.items[0]?.project_item?.split("-").pop() || "1")} field="est_materials" value={row.estMaterials} />
                        }
                      </td>
                      <td className="border px-3 py-1.5 text-right">
                        {row.basicHours > 0 ? (
                          <a href={`/timesheets/reports/?highlight=${row.projectnumber}`} className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>{fmt(row.basicHours)}</a>
                        ) : "–"}
                      </td>
                      <td className="border px-3 py-1.5 text-right">
                        {row.otHours > 0 ? (
                          <a href={`/timesheets/reports/?highlight=${row.projectnumber}`} className="text-amber-600 font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{row.otHours.toFixed(2)}</a>
                        ) : "–"}
                      </td>
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.labourCost)}</td>
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.committed)}</td>
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.received)}</td>
                      <td className="border px-3 py-1.5 text-right">{fmtCurrency(row.invoiced)}</td>
                      <td className={`border px-3 py-1.5 text-right font-medium ${row.estLabour > 0 ? (row.labourVariance >= 0 ? "text-green-700" : "text-red-600") : ""}`}>
                        {row.estLabour > 0 ? fmtSignedCurrency(row.labourVariance) : "–"}
                      </td>
                      <td className={`border px-3 py-1.5 text-right font-medium ${row.estMaterials > 0 ? (row.materialsVariance >= 0 ? "text-green-700" : "text-red-600") : ""}`}>
                        {row.estMaterials > 0 ? fmtSignedCurrency(row.materialsVariance) : "–"}
                      </td>
                      <td className={`border px-3 py-1.5 text-right font-medium ${row.projectValue > 0 && row.estTotalCost > 0 ? (row.plannedMargin >= 0 ? "text-green-700" : "text-red-600") : ""}`}>
                        {row.projectValue > 0 && row.estTotalCost > 0 ? fmtSignedCurrency(row.plannedMargin) : "–"}
                      </td>
                    </tr>
                    {row.hasMultipleItems && isExpanded && row.items.map((item) => {
                      const dashIdx = item.project_item.lastIndexOf("-");
                      const itemSeq = parseInt(item.project_item.substring(dashIdx + 1)) || 1;
                      return (
                        <tr key={item.project_item} className="hover:bg-gray-50 text-gray-600" onClick={(e) => e.stopPropagation()}>
                          <td className="border px-3 py-1 font-mono text-xs sticky left-0 bg-white z-10 pl-8">
                            {item.project_item}
                          </td>
                          <td className="border px-3 py-1 text-xs text-gray-400 truncate max-w-64 sticky left-28 bg-white z-10">
                            {item.description || "–"}
                          </td>
                          {/* Summary columns */}
                          <td className="border px-3 py-1 text-right text-xs">{fmtCurrency(item.projectValue)}</td>
                          <td className="border px-3 py-1 text-right text-xs">{(item.estLabour + item.estMaterials) > 0 ? fmtCurrency(item.estLabour + item.estMaterials) : "–"}</td>
                          <td className="border px-3 py-1 text-right text-xs">{fmtCurrency(item.totalCost)}</td>
                          <td className="border px-3 py-1 text-xs" onClick={(e) => e.stopPropagation()}>
                            <PctCell projectnumber={row.projectnumber} itemSeq={itemSeq} value={item.pctComplete} />
                          </td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                          {/* Detail columns */}
                          <td className="border px-3 py-1 text-xs bg-blue-50/30" onClick={(e) => e.stopPropagation()}>
                            <EstCell projectnumber={row.projectnumber} itemSeq={itemSeq} field="est_labour" value={item.estLabour} />
                          </td>
                          <td className="border px-3 py-1 text-xs bg-blue-50/30" onClick={(e) => e.stopPropagation()}>
                            <EstCell projectnumber={row.projectnumber} itemSeq={itemSeq} field="est_materials" value={item.estMaterials} />
                          </td>
                          <td className="border px-3 py-1 text-right text-xs">{fmt(item.basicHours)}</td>
                          <td className="border px-3 py-1 text-right text-xs">
                            {item.otHours > 0 ? <span className="text-amber-600">{item.otHours.toFixed(2)}</span> : "–"}
                          </td>
                          <td className="border px-3 py-1 text-right text-xs">{fmtCurrency(item.labourCost)}</td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                          <td className="border px-3 py-1 text-right text-xs">–</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}

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
              <Bar yAxisId="left" dataKey="Labour" stackId="spend" fill="#061b37" hide={hiddenSeries.has("Labour")} />
              <Bar yAxisId="left" dataKey="Committed" stackId="spend" fill="#bfdbfe" hide={hiddenSeries.has("Committed")} />
              <Bar yAxisId="left" dataKey="Received" stackId="spend" fill="#60a5fa" hide={hiddenSeries.has("Received")} />
              <Bar yAxisId="left" dataKey="Invoice Cleared" stackId="spend" fill="#97caeb" hide={hiddenSeries.has("Invoice Cleared")} />
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
                dataKey="Cumulative Materials"
                stroke="#60a5fa"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={{ r: 2 }}
                hide={hiddenSeries.has("Cumulative Materials")}
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

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border rounded shadow-lg z-50 py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              toggleCompleted(contextMenu.projectnumber);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer"
          >
            {completedMap.get(contextMenu.projectnumber)
              ? `Mark ${contextMenu.projectnumber} as live`
              : `Mark ${contextMenu.projectnumber} as completed`
            }
          </button>
        </div>
      )}
    </div>
  );
}
