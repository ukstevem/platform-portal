"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer, ReferenceLine,
} from "recharts";

type ProjectEVM = {
  projectnumber: string;
  description: string;
  bac: number;           // Budget at Completion (est total cost)
  contractValue: number;
  pctComplete: number;   // manual 0-100
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  ac: number;            // Actual Cost
  ev: number;            // Earned Value = BAC × % complete
  pv: number;            // Planned Value = BAC × planned % at this date
  cv: number;            // Cost Variance = EV - AC
  sv: number;            // Schedule Variance = EV - PV
  cpi: number;           // Cost Performance Index = EV / AC
  spi: number;           // Schedule Performance Index = EV / PV
  eac: number;           // Estimate at Completion = AC + ETC
  etc: number;           // Estimate to Complete (manual or BAC/CPI - AC)
  etcIsManual: boolean;  // Whether ETC is PM-entered or formula-based
  vac: number;           // Variance at Completion = BAC - EAC
  tcpi: number;          // To Complete Performance Index = (BAC - EV) / (EAC - AC)
  pctBudgetSpent: number; // AC / BAC × 100
};

// S-curve (sigmoid) distribution — realistic project spend profile
function sCurvePct(linearPct: number): number {
  // Attempt to clamp between 0 and 1
  const t = Math.max(0, Math.min(1, linearPct / 100));
  // Sigmoid: slow start, fast middle, slow finish
  // Using a logistic-like curve: 1 / (1 + e^(-k*(t-0.5)))
  const k = 8; // steepness — higher = sharper transition
  const s = 1 / (1 + Math.exp(-k * (t - 0.5)));
  // Normalise so s(0)=0 and s(1)=1
  const s0 = 1 / (1 + Math.exp(-k * -0.5));
  const s1 = 1 / (1 + Math.exp(-k * 0.5));
  return ((s - s0) / (s1 - s0)) * 100;
}

// Calculate PV % at a given date — uses milestones if available, else S-curve
function calcPlannedPct(
  plannedStart: string | null,
  plannedEnd: string | null,
  milestones?: { planned_date: string | null; planned_amount: number }[],
  bac?: number,
  atDate?: number, // timestamp, defaults to now
): number {
  const now = atDate ?? Date.now();

  // If milestones with dates exist, use milestone-weighted PV
  if (milestones && milestones.length > 0 && bac && bac > 0) {
    const validMs = milestones.filter((m) => m.planned_date && m.planned_amount > 0);
    if (validMs.length > 0) {
      let cumValue = 0;
      for (const m of validMs) {
        const msDate = new Date(m.planned_date!).getTime();
        if (now >= msDate) cumValue += m.planned_amount;
      }
      return Math.min((cumValue / bac) * 100, 100);
    }
  }

  // Fallback: S-curve between planned dates
  if (!plannedStart || !plannedEnd) return 0;
  const start = new Date(plannedStart).getTime();
  const end = new Date(plannedEnd).getTime();
  if (now <= start) return 0;
  if (now >= end) return 100;
  const linearPct = ((now - start) / (end - start)) * 100;
  return sCurvePct(linearPct);
}

export default function EarnedValuePage() {
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<ProjectEVM[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [monthlyData, setMonthlyData] = useState<Map<string, { month: string; ac: number; ev: number; pv: number }[]>>(new Map());
  const [loading, setLoading] = useState(true);

  // Draft ETC overrides (not yet committed to DB)
  const [etcDrafts, setEtcDrafts] = useState<Map<string, number>>(new Map());
  // Track which projects need the itemId for saving
  const [itemIdMap, setItemIdMap] = useState<Map<string, { id: string; item_seq: number }[]>>(new Map());
  // ETC history for trend chart
  const [etcHistory, setEtcHistory] = useState<Map<string, { date: string; value: number }[]>>(new Map());
  // Invoice schedule for cash flow
  const [invoiceSchedule, setInvoiceSchedule] = useState<Map<string, { planned_date: string | null; planned_amount: number; invoiced: boolean; actual_date: string | null; actual_amount: number | null }[]>>(new Map());
  // Detail panel tab
  const [detailTab, setDetailTab] = useState<"scurve" | "etc" | "burnrate" | "cashflow">("scurve");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const pageSize = 1000;

      // Fetch project register items (contract value + estimates)
      const projMap = new Map<string, { desc: string; contractValue: number; estCost: number }>();
      const idMap = new Map<string, { id: string; item_seq: number }[]>();
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_register_items")
          .select("id, projectnumber, item_seq, line_desc, value, est_labour, est_materials")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          const existing = projMap.get(r.projectnumber);
          const itemKey01 = `${r.projectnumber}-01`;
          const itemKey = `${r.projectnumber}-${String(r.item_seq).padStart(2, "0")}`;
          if (!existing) {
            projMap.set(r.projectnumber, {
              desc: r.line_desc,
              contractValue: Number(r.value) || 0,
              estCost: (Number(r.est_labour) || 0) + (Number(r.est_materials) || 0),
            });
          } else {
            if (itemKey === itemKey01) existing.desc = r.line_desc;
            existing.contractValue += Number(r.value) || 0;
            existing.estCost += (Number(r.est_labour) || 0) + (Number(r.est_materials) || 0);
          }
          if (!idMap.has(r.projectnumber)) idMap.set(r.projectnumber, []);
          idMap.get(r.projectnumber)!.push({ id: r.id, item_seq: r.item_seq });
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Fetch commercial data per item, then roll up to project level
      // Intermediate: per item data
      const itemCommercial = new Map<string, { pctComplete: number; etcManual: number | null; estCost: number; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null }[]>();
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_items_commercial")
          .select("projectnumber, item_seq, pct_complete, etc_manual, planned_start_date, planned_completion_date, actual_start_date")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          const itemKey = `${r.projectnumber}-${String(r.item_seq).padStart(2, "0")}`;
          const info = projMap.get(r.projectnumber);
          // Get est cost for this item for weighting
          const estCost = info ? (info.estCost > 0 ? info.estCost : 1) : 1; // approximate
          if (!itemCommercial.has(r.projectnumber)) itemCommercial.set(r.projectnumber, []);
          itemCommercial.get(r.projectnumber)!.push({
            pctComplete: r.pct_complete ?? 0,
            etcManual: r.etc_manual != null ? Number(r.etc_manual) : null,
            estCost: 1, // weight equally for now, refined below
            plannedStart: r.planned_start_date,
            plannedEnd: r.planned_completion_date,
            actualStart: r.actual_start_date,
          });
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      // Roll up to project level
      const commercialMap = new Map<string, { pctComplete: number; etcManual: number | null; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null }>();
      for (const [proj, items] of itemCommercial) {
        const avgPct = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.pctComplete, 0) / items.length) : 0;
        // Sum manual ETC across items (null if none set)
        const etcItems = items.filter((i) => i.etcManual != null);
        const etcManual = etcItems.length > 0 ? etcItems.reduce((s, i) => s + (i.etcManual ?? 0), 0) : null;
        // Earliest planned start, latest planned end, earliest actual start
        const starts = items.map((i) => i.plannedStart).filter(Boolean) as string[];
        const ends = items.map((i) => i.plannedEnd).filter(Boolean) as string[];
        const actStarts = items.map((i) => i.actualStart).filter(Boolean) as string[];
        commercialMap.set(proj, {
          pctComplete: avgPct,
          etcManual,
          plannedStart: starts.length > 0 ? starts.sort()[0] : null,
          plannedEnd: ends.length > 0 ? ends.sort().reverse()[0] : null,
          actualStart: actStarts.length > 0 ? actStarts.sort()[0] : null,
        });
      }

      // Fetch timesheet entries
      const labourByProject = new Map<string, number>();
      const monthlyLabour = new Map<string, Map<string, number>>();
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("timesheet_entries")
          .select("project_item, hours, is_overtime, work_date")
          .range(from, from + pageSize - 1);
        if (cancelled) return;
        if (!data || data.length === 0) break;
        for (const e of data) {
          if (["SHOPWORK-01", "HOLIDAY-01", "TRAINING-01", "SICK-01"].includes(e.project_item)) continue;
          const proj = e.project_item.replace(/-\d+$/, "");
          const hrs = Number(e.hours);
          const cost = e.is_overtime ? hrs * 49 * 1.5 : hrs * 49;
          labourByProject.set(proj, (labourByProject.get(proj) ?? 0) + cost);
          const month = e.work_date?.slice(0, 7);
          if (month) {
            if (!monthlyLabour.has(proj)) monthlyLabour.set(proj, new Map());
            monthlyLabour.get(proj)!.set(month, (monthlyLabour.get(proj)!.get(month) ?? 0) + cost);
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Fetch PO spend via po_line_items
      const poByProject = new Map<string, number>();
      const monthlyPO = new Map<string, Map<string, number>>();
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
          const val = Number(d.total) || 0;
          const proj = po.project_id;
          poByProject.set(proj, (poByProject.get(proj) ?? 0) + val);
          // Use received date if available, otherwise PO creation date
          const dateStr = d.exped_completed_date ?? po.created_at ?? "";
          const month = dateStr.slice(0, 7);
          if (month) {
            if (!monthlyPO.has(proj)) monthlyPO.set(proj, new Map());
            monthlyPO.get(proj)!.set(month, (monthlyPO.get(proj)!.get(month) ?? 0) + val);
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }

      if (cancelled) return;

      // Fetch invoice schedule (needed for milestone-weighted PV)
      const invSched = new Map<string, { planned_date: string | null; planned_amount: number; invoiced: boolean; actual_date: string | null; actual_amount: number | null }[]>();
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_invoice_schedule")
          .select("projectnumber, planned_date, planned_amount, invoiced, actual_date, actual_amount")
          .order("planned_date")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          if (!invSched.has(r.projectnumber)) invSched.set(r.projectnumber, []);
          invSched.get(r.projectnumber)!.push({
            planned_date: r.planned_date,
            planned_amount: Number(r.planned_amount) || 0,
            invoiced: !!r.invoiced,
            actual_date: r.actual_date,
            actual_amount: r.actual_amount != null ? Number(r.actual_amount) : null,
          });
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      if (cancelled) return;

      // Build EVM summaries
      const summaries: ProjectEVM[] = [];
      for (const [proj, info] of projMap) {
        if (info.estCost <= 0 || info.contractValue <= 0) continue;

        const commercial = commercialMap.get(proj);
        const pctComplete = commercial?.pctComplete ?? 0;
        const bac = info.estCost;
        const ac = (labourByProject.get(proj) ?? 0) + (poByProject.get(proj) ?? 0);
        const ev = bac * (pctComplete / 100);
        const projMilestones = invSched.get(proj);
        const plannedPct = calcPlannedPct(commercial?.plannedStart ?? null, commercial?.plannedEnd ?? null, projMilestones, bac);
        const pv = bac * (plannedPct / 100);

        const cv = ev - ac;
        const sv = ev - pv;
        const cpi = ac > 0 ? ev / ac : 0;
        const spi = pv > 0 ? ev / pv : 0;
        // Use manual ETC if available, otherwise formula-based
        const etcManual = commercial?.etcManual ?? null;
        const etcFormula = cpi > 0 ? (bac / cpi) - ac : 0;
        const etc = etcManual ?? etcFormula;
        const eac = ac + etc;
        const vac = bac - eac;
        const tcpi = (eac - ac) > 0 ? (bac - ev) / (eac - ac) : 0;
        const pctBudgetSpent = bac > 0 ? (ac / bac) * 100 : 0;

        summaries.push({
          projectnumber: proj,
          description: info.desc,
          bac,
          contractValue: info.contractValue,
          pctComplete,
          plannedStart: commercial?.plannedStart ?? null,
          plannedEnd: commercial?.plannedEnd ?? null,
          actualStart: commercial?.actualStart ?? null,
          ac, ev, pv, cv, sv, cpi, spi, eac, etc, etcIsManual: etcManual != null, vac, tcpi, pctBudgetSpent,
        });
      }
      summaries.sort((a, b) => (parseInt(b.projectnumber) || 0) - (parseInt(a.projectnumber) || 0));

      // Build monthly EV data per project
      const mData = new Map<string, { month: string; ac: number; ev: number; pv: number }[]>();
      for (const s of summaries) {
        const labourMonths = monthlyLabour.get(s.projectnumber) ?? new Map();
        const poMonths = monthlyPO.get(s.projectnumber) ?? new Map();
        const allMonths = new Set([...labourMonths.keys(), ...poMonths.keys()]);
        const sorted = Array.from(allMonths).sort();

        let cumAC = 0;
        const points: { month: string; ac: number; ev: number; pv: number }[] = [];

        for (let i = 0; i < sorted.length; i++) {
          const month = sorted[i];
          cumAC += (labourMonths.get(month) ?? 0) + (poMonths.get(month) ?? 0);

          // EV at this point: proportional to cumulative spend vs final, scaled by manual % complete
          const spendPct = s.bac > 0 ? cumAC / s.bac : 0;
          const evAtMonth = s.bac * Math.min(spendPct * (s.pctComplete / 100) / Math.max(spendPct, 0.01), s.pctComplete / 100);

          // PV: milestone-weighted if available, else S-curve
          const [ym, mm] = month.split("-");
          const monthEnd = new Date(Number(ym), Number(mm), 0).getTime();
          const projMs = invSched.get(s.projectnumber);
          const pvPct = calcPlannedPct(s.plannedStart, s.plannedEnd, projMs, s.bac, monthEnd);
          const pvAtMonth = s.bac * (pvPct / 100);

          const [y, mo] = month.split("-");
          const label = new Date(Number(y), Number(mo) - 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
          points.push({
            month: label,
            ac: Math.round(cumAC * 100) / 100,
            ev: Math.round(evAtMonth * 100) / 100,
            pv: Math.round(pvAtMonth * 100) / 100,
          });
        }
        mData.set(s.projectnumber, points);
      }

      // Fetch ETC history
      const etcHist = new Map<string, { date: string; value: number }[]>();
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_etc_history")
          .select("projectnumber, etc_value, created_at")
          .order("created_at")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          if (!etcHist.has(r.projectnumber)) etcHist.set(r.projectnumber, []);
          etcHist.get(r.projectnumber)!.push({
            date: new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }),
            value: Number(r.etc_value),
          });
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }

      setProjects(summaries);
      setItemIdMap(idMap);
      setMonthlyData(mData);
      setEtcHistory(etcHist);
      setInvoiceSchedule(invSched);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply draft ETC to project metrics for live preview
  const projectsWithDrafts = useMemo(() => {
    if (etcDrafts.size === 0) return projects;
    return projects.map((p) => {
      let updated = p;
      // Apply % complete draft
      const pctDraft = etcDrafts.get(`pct_${p.projectnumber}`);
      if (pctDraft != null) {
        const ev = p.bac * (pctDraft / 100);
        const cv = ev - p.ac;
        const sv = ev - p.pv;
        const cpi = p.ac > 0 ? ev / p.ac : 0;
        const spi = p.pv > 0 ? ev / p.pv : 0;
        const pctBudgetSpent = p.bac > 0 ? (p.ac / p.bac) * 100 : 0;
        updated = { ...updated, pctComplete: pctDraft, ev, cv, sv, cpi, spi, pctBudgetSpent };
      }
      // Apply ETC draft
      const etcDraft = etcDrafts.get(p.projectnumber);
      if (etcDraft != null) {
        const etc = etcDraft;
        const eac = updated.ac + etc;
        const vac = updated.bac - eac;
        const tcpi = (eac - updated.ac) > 0 ? (updated.bac - updated.ev) / (eac - updated.ac) : 0;
        updated = { ...updated, etc, eac, vac, tcpi, etcIsManual: true };
      }
      return updated === p ? p : updated;
    });
  }, [projects, etcDrafts]);

  // Commit all draft ETCs to Supabase
  const commitDrafts = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    for (const [key, value] of etcDrafts) {
      // Handle % complete drafts (prefixed with pct_)
      if (key.startsWith("pct_")) {
        const proj = key.slice(4);
        const items = itemIdMap.get(proj) ?? [];
        for (const item of items) {
          await supabase.from("project_items_commercial").upsert(
            { project_item_id: item.id, projectnumber: proj, item_seq: item.item_seq, pct_complete: value },
            { onConflict: "projectnumber,item_seq" }
          );
        }
        continue;
      }
      // Handle ETC drafts
      const proj = key;
      const etcValue = value;
      const items = itemIdMap.get(proj) ?? [];
      if (items.length === 1) {
        await supabase.from("project_items_commercial").upsert(
          { project_item_id: items[0].id, projectnumber: proj, item_seq: items[0].item_seq, etc_manual: etcValue },
          { onConflict: "projectnumber,item_seq" }
        );
        await supabase.from("project_etc_history").insert({
          project_item_id: items[0].id, projectnumber: proj, item_seq: items[0].item_seq,
          etc_value: etcValue, entered_by: authUser?.id ?? null,
        });
      } else if (items.length > 1) {
        const perItem = Math.round((etcValue / items.length) * 100) / 100;
        for (const item of items) {
          await supabase.from("project_items_commercial").upsert(
            { project_item_id: item.id, projectnumber: proj, item_seq: item.item_seq, etc_manual: perItem },
            { onConflict: "projectnumber,item_seq" }
          );
          await supabase.from("project_etc_history").insert({
            project_item_id: item.id, projectnumber: proj, item_seq: item.item_seq,
            etc_value: perItem, entered_by: authUser?.id ?? null,
          });
        }
      }
    }
    // Update projects state with all committed values
    setProjects((prev) => prev.map((p) => {
      const pctDraft = etcDrafts.get(`pct_${p.projectnumber}`);
      const etcDraft = etcDrafts.get(p.projectnumber);
      if (pctDraft == null && etcDraft == null) return p;
      let updated = { ...p };
      if (pctDraft != null) {
        const ev = p.bac * (pctDraft / 100);
        updated = { ...updated, pctComplete: pctDraft, ev, cv: ev - p.ac, sv: ev - p.pv, cpi: p.ac > 0 ? ev / p.ac : 0, spi: p.pv > 0 ? ev / p.pv : 0 };
      }
      if (etcDraft != null) {
        const eac = updated.ac + etcDraft;
        updated = { ...updated, etc: etcDraft, eac, vac: updated.bac - eac, etcIsManual: true };
      }
      return updated;
    }));
    setEtcDrafts(new Map());
  };

  const fmtC = (v: number) => {
    const abs = Math.abs(v);
    const str = `£${abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return v < 0 ? `-${str}` : str;
  };

  // Portfolio totals
  const totals = useMemo(() => {
    return projectsWithDrafts.reduce(
      (acc, p) => ({
        bac: acc.bac + p.bac,
        ac: acc.ac + p.ac,
        ev: acc.ev + p.ev,
        pv: acc.pv + p.pv,
      }),
      { bac: 0, ac: 0, ev: 0, pv: 0 }
    );
  }, [projectsWithDrafts]);

  const portfolioCPI = totals.ac > 0 ? totals.ev / totals.ac : 0;
  const portfolioSPI = totals.pv > 0 ? totals.ev / totals.pv : 0;
  const portfolioCV = totals.ev - totals.ac;
  const portfolioSV = totals.ev - totals.pv;

  const chartData = useMemo(() => {
    if (!selectedProject) return [];
    const raw = monthlyData.get(selectedProject) ?? [];
    if (raw.length === 0) return [];
    // Recalculate EV based on current (possibly draft) % complete
    const summary = projectsWithDrafts.find((p) => p.projectnumber === selectedProject);
    if (!summary || summary.bac === 0) return raw;
    // EV at each point: scale proportionally to AC progress × overall % complete
    const finalAC = raw[raw.length - 1]?.ac ?? 0;
    return raw.map((d) => {
      const acPct = finalAC > 0 ? d.ac / finalAC : 0;
      const evAtPoint = summary.bac * (summary.pctComplete / 100) * acPct;
      return { ...d, ev: Math.round(evAtPoint * 100) / 100 };
    });
  }, [selectedProject, monthlyData, projectsWithDrafts]);
  const selectedSummary = projectsWithDrafts.find((p) => p.projectnumber === selectedProject);

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Earned Value Analysis</h1>
        <p className="text-gray-600">Sign in to view earned value data</p>
        <AuthButton redirectTo="/operations/earned-value" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 max-w-full mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Earned Value Management</h1>
        {etcDrafts.size > 0 && (
          <button
            type="button"
            onClick={commitDrafts}
            className="rounded bg-[#061b37] text-white px-4 py-1.5 text-sm cursor-pointer hover:bg-[#0a2d5c]"
          >
            Commit Changes ({etcDrafts.size})
          </button>
        )}
      </div>

      {/* Portfolio KPIs */}
      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="border rounded p-4 bg-white">
            <div className="text-xs text-gray-500 uppercase">Cost Performance (CPI)</div>
            <div className={`text-2xl font-bold mt-1 ${portfolioCPI >= 1 ? "text-green-700" : "text-red-600"}`}>
              {portfolioCPI.toFixed(2)}
            </div>
            <div className="text-xs text-gray-400 mt-1">{portfolioCPI >= 1 ? "Under budget" : "Over budget"}</div>
          </div>
          <div className="border rounded p-4 bg-white">
            <div className="text-xs text-gray-500 uppercase">Schedule Performance (SPI)</div>
            <div className={`text-2xl font-bold mt-1 ${portfolioSPI >= 1 ? "text-green-700" : portfolioSPI > 0 ? "text-amber-600" : "text-gray-400"}`}>
              {portfolioSPI > 0 ? portfolioSPI.toFixed(2) : "N/A"}
            </div>
            <div className="text-xs text-gray-400 mt-1">{portfolioSPI >= 1 ? "Ahead of schedule" : portfolioSPI > 0 ? "Behind schedule" : "No schedule data"}</div>
          </div>
          <div className="border rounded p-4 bg-white">
            <div className="text-xs text-gray-500 uppercase">Cost Variance (CV)</div>
            <div className={`text-lg font-bold mt-1 ${portfolioCV >= 0 ? "text-green-700" : "text-red-600"}`}>
              {fmtC(portfolioCV)}
            </div>
            <div className="text-xs text-gray-400 mt-1">EV − AC</div>
          </div>
          <div className="border rounded p-4 bg-white">
            <div className="text-xs text-gray-500 uppercase">Schedule Variance (SV)</div>
            <div className={`text-lg font-bold mt-1 ${portfolioSV >= 0 ? "text-green-700" : portfolioSV !== 0 ? "text-red-600" : "text-gray-400"}`}>
              {totals.pv > 0 ? fmtC(portfolioSV) : "N/A"}
            </div>
            <div className="text-xs text-gray-400 mt-1">EV − PV</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 py-4">Loading earned value data...</div>
      ) : projects.length === 0 ? (
        <div className="text-gray-500 py-8 text-center border rounded">
          No projects with both contract values and estimates found.
          <br />
          <span className="text-xs">EVM requires Est. Labour, Est. Materials, and % Complete to be set on the Project Cost Overview page.</span>
        </div>
      ) : (
        <div className="overflow-auto border rounded" style={{ maxHeight: "calc(100vh - 350px)" }}>
          <table className="border-collapse text-sm w-full">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-50">
                <th className="border px-3 py-2 text-left sticky left-0 bg-gray-50 z-30 min-w-28">Project</th>
                <th className="border px-3 py-2 text-left sticky left-28 bg-gray-50 z-30 min-w-48">Description</th>
                <th className="border px-3 py-2 text-right min-w-20">% Done</th>
                <th className="border px-3 py-2 text-right min-w-28">BAC</th>
                <th className="border px-3 py-2 text-right min-w-28">PV</th>
                <th className="border px-3 py-2 text-right min-w-28">EV</th>
                <th className="border px-3 py-2 text-right min-w-28">AC</th>
                <th className="border px-3 py-2 text-right min-w-20">CPI</th>
                <th className="border px-3 py-2 text-right min-w-20">SPI</th>
                <th className="border px-3 py-2 text-right min-w-28">CV</th>
                <th className="border px-3 py-2 text-right min-w-28">SV</th>
                <th className="border px-3 py-2 text-right min-w-28">EAC</th>
                <th className="border px-3 py-2 text-right min-w-28">ETC</th>
                <th className="border px-3 py-2 text-right min-w-28">VAC</th>
                <th className="border px-3 py-2 text-right min-w-20">TCPI</th>
                <th className="border px-3 py-2 text-right min-w-24">Budget Health</th>
              </tr>
            </thead>
            <tbody>
              {projectsWithDrafts.map((p) => (
                <tr
                  key={p.projectnumber}
                  className={`hover:bg-gray-50 cursor-pointer ${selectedProject === p.projectnumber ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""}`}
                  onClick={() => setSelectedProject(selectedProject === p.projectnumber ? null : p.projectnumber)}
                >
                  <td className={`border px-3 py-1.5 font-mono text-xs font-medium sticky left-0 z-10 ${selectedProject === p.projectnumber ? "bg-blue-50" : "bg-white"}`}>
                    {p.projectnumber}
                  </td>
                  <td className={`border px-3 py-1.5 text-xs text-gray-600 truncate max-w-64 sticky left-28 z-10 ${selectedProject === p.projectnumber ? "bg-blue-50" : "bg-white"}`}>{p.description}</td>
                  <td className="border px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={etcDrafts.has(`pct_${p.projectnumber}`) ? etcDrafts.get(`pct_${p.projectnumber}`) : (p.pctComplete || "")}
                      placeholder="set %"
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setEtcDrafts((prev) => {
                          const next = new Map(prev);
                          if (isNaN(val)) next.delete(`pct_${p.projectnumber}`);
                          else next.set(`pct_${p.projectnumber}`, Math.max(0, Math.min(100, val)));
                          return next;
                        });
                      }}
                      className={`w-16 text-right text-xs border rounded px-1 py-0.5 ${etcDrafts.has(`pct_${p.projectnumber}`) ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}
                    />
                  </td>
                  <td className="border px-3 py-1.5 text-right">{fmtC(p.bac)}</td>
                  <td className="border px-3 py-1.5 text-right">{p.pv > 0 ? fmtC(p.pv) : <span className="text-gray-300">–</span>}</td>
                  <td className="border px-3 py-1.5 text-right font-medium">{fmtC(p.ev)}</td>
                  <td className="border px-3 py-1.5 text-right">{fmtC(p.ac)}</td>
                  <td className={`border px-3 py-1.5 text-right font-medium ${p.cpi >= 1 ? "text-green-700" : p.cpi > 0 ? "text-red-600" : ""}`}>
                    {p.cpi > 0 ? p.cpi.toFixed(2) : "–"}
                  </td>
                  <td className={`border px-3 py-1.5 text-right font-medium ${p.spi >= 1 ? "text-green-700" : p.spi > 0 ? "text-amber-600" : ""}`}>
                    {p.spi > 0 ? p.spi.toFixed(2) : "–"}
                  </td>
                  <td className={`border px-3 py-1.5 text-right ${p.cv >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {p.ac > 0 ? fmtC(p.cv) : "–"}
                  </td>
                  <td className={`border px-3 py-1.5 text-right ${p.sv >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {p.pv > 0 ? fmtC(p.sv) : "–"}
                  </td>
                  <td className="border px-3 py-1.5 text-right">{p.cpi > 0 ? fmtC(p.eac) : "–"}</td>
                  <td className={`border px-3 py-1.5 text-right ${p.etc >= 0 ? "" : "text-red-600"}`} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        step="0.01"
                        value={etcDrafts.has(p.projectnumber) ? etcDrafts.get(p.projectnumber) : (p.etcIsManual ? p.etc : "")}
                        placeholder={p.etc > 0 && !p.etcIsManual ? p.etc.toFixed(0) : "–"}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setEtcDrafts((prev) => {
                            const next = new Map(prev);
                            if (isNaN(val)) next.delete(p.projectnumber);
                            else next.set(p.projectnumber, val);
                            return next;
                          });
                        }}
                        className={`w-24 text-right text-sm border rounded px-1 py-0.5 ${etcDrafts.has(p.projectnumber) ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}
                      />
                      <span className="text-xs text-gray-400" title={p.etcIsManual ? "PM estimate" : "Formula: BAC/CPI - AC"}>
                        {p.etcIsManual ? "PM" : "calc"}
                      </span>
                    </div>
                  </td>
                  <td className={`border px-3 py-1.5 text-right ${p.vac >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {p.cpi > 0 ? fmtC(p.vac) : "–"}
                  </td>
                  <td className={`border px-3 py-1.5 text-right font-medium ${p.tcpi > 1.1 ? "text-red-600" : p.tcpi > 0 ? "text-green-700" : ""}`}>
                    {p.tcpi > 0 ? p.tcpi.toFixed(2) : "–"}
                  </td>
                  <td className="border px-3 py-1.5 text-center">
                    {p.pctComplete > 0 && p.pctBudgetSpent > 0 ? (() => {
                      const ratio = p.pctBudgetSpent / p.pctComplete;
                      if (ratio > 1.2) return <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Over</span>;
                      if (ratio > 0.9) return <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">Watch</span>;
                      return <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">Good</span>;
                    })() : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail panel for selected project */}
      {selectedProject && selectedSummary && (
        <div className="mt-6 border rounded bg-white">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4">
            <div>
              <h2 className="text-lg font-semibold">
                {selectedProject} — {selectedSummary.description}
              </h2>
              <div className="text-xs text-gray-500 mt-1">
                BAC: {fmtC(selectedSummary.bac)} | % Complete: {selectedSummary.pctComplete}% |
                CPI: {selectedSummary.cpi > 0 ? selectedSummary.cpi.toFixed(2) : "N/A"} |
                SPI: {selectedSummary.spi > 0 ? selectedSummary.spi.toFixed(2) : "N/A"} |
                TCPI: {selectedSummary.tcpi > 0 ? selectedSummary.tcpi.toFixed(2) : "N/A"}
              </div>
            </div>
            <button type="button" onClick={() => setSelectedProject(null)} className="text-gray-400 hover:text-gray-600 text-xl cursor-pointer">✕</button>
          </div>

          {/* Tabs */}
          <div className="flex border-b px-4 mt-3">
            {([
              ["scurve", "S-Curve (PV/EV/AC)"],
              ["burnrate", "Burn Rate & CPI"],
              ["etc", "ETC Trend"],
              ["cashflow", "Cash Flow Forecast"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDetailTab(key as typeof detailTab)}
                className={`px-3 py-2 text-xs font-medium cursor-pointer border-b-2 -mb-px ${detailTab === key ? "border-[#061b37] text-[#061b37]" : "border-transparent text-gray-500 hover:text-gray-700"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {/* S-Curve */}
            {detailTab === "scurve" && (
              chartData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={350}>
                    <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(value: number, name: string) => [`£${value.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, name]} />
                      <Legend />
                      {selectedSummary.bac > 0 && (
                        <ReferenceLine y={selectedSummary.bac} stroke="#9ca3af" strokeDasharray="8 4"
                          label={{ value: `BAC ${fmtC(selectedSummary.bac)}`, position: "insideTopRight", fontSize: 11, fill: "#9ca3af" }} />
                      )}
                      {chartData.some((d) => d.pv > 0) && (
                        <Line type="monotone" dataKey="pv" name="Planned Value (PV)" stroke="#6b7280" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 2 }} />
                      )}
                      <Line type="monotone" dataKey="ev" name="Earned Value (EV)" stroke="#15803d" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="ac" name="Actual Cost (AC)" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="text-xs text-gray-500 mt-2">
                    <strong>EV above AC</strong> → under budget. <strong>EV above PV</strong> → ahead of schedule.
                    {!selectedSummary.plannedStart && <span className="text-amber-500 ml-2">Set planned dates for PV.</span>}
                  </div>
                </>
              ) : <div className="text-center text-gray-400 py-8">No spend data available</div>
            )}

            {/* Burn Rate & Cumulative CPI */}
            {detailTab === "burnrate" && (
              chartData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={350}>
                    <ComposedChart
                      data={(() => {
                        let cumAC = 0;
                        let cumEV = 0;
                        return chartData.map((d) => {
                          const monthCost = (d.ac - cumAC) > 0 ? d.ac - cumAC : d.ac;
                          cumAC = d.ac;
                          cumEV = d.ev;
                          const cpiAtMonth = cumAC > 0 ? cumEV / cumAC : 0;
                          return { month: d.month, "Monthly Spend": Math.round(monthCost * 100) / 100, CPI: Math.round(cpiAtMonth * 100) / 100 };
                        });
                      })()}
                      margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} domain={[0, 2]} />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="Monthly Spend" fill="#061b37" />
                      <Line yAxisId="right" type="monotone" dataKey="CPI" stroke="#15803d" strokeWidth={2} dot={{ r: 3 }} />
                      <ReferenceLine yAxisId="right" y={1} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "CPI = 1.0", position: "insideTopRight", fontSize: 11, fill: "#dc2626" }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="text-xs text-gray-500 mt-2">
                    Bars show monthly cost. Line shows cumulative CPI — above red line is under budget.
                  </div>
                </>
              ) : <div className="text-center text-gray-400 py-8">No spend data available</div>
            )}

            {/* ETC Trend */}
            {detailTab === "etc" && (() => {
              const history = etcHistory.get(selectedProject) ?? [];
              return history.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={350}>
                    <ComposedChart data={history} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(value: number) => [`£${value.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, "ETC"]} />
                      <Line type="monotone" dataKey="value" name="ETC (PM Estimate)" stroke="#061b37" strokeWidth={2} dot={{ r: 4 }} />
                      {selectedSummary.bac > 0 && (
                        <ReferenceLine y={selectedSummary.bac} stroke="#9ca3af" strokeDasharray="8 4"
                          label={{ value: `BAC ${fmtC(selectedSummary.bac)}`, position: "insideTopRight", fontSize: 11, fill: "#9ca3af" }} />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="text-xs text-gray-500 mt-2">
                    PM Estimate to Complete over time. Trend should decrease as project progresses. Rising trend indicates scope creep or underestimation.
                  </div>
                </>
              ) : (
                <div className="text-center text-gray-400 py-8">
                  No ETC history yet. Enter an ETC value in the table above and commit to start tracking.
                </div>
              );
            })()}

            {/* Cash Flow Forecast */}
            {detailTab === "cashflow" && (() => {
              const invoices = invoiceSchedule.get(selectedProject) ?? [];
              // Build monthly cash flow: costs out (from chartData) vs revenue in (from invoice schedule)
              const cfMonths = new Map<string, { costsOut: number; revenueIn: number }>();

              // Costs from chart data (cumulative, so we need monthly deltas)
              let prevAC = 0;
              for (const d of chartData) {
                cfMonths.set(d.month, { costsOut: Math.round((d.ac - prevAC) * 100) / 100, revenueIn: 0 });
                prevAC = d.ac;
              }

              // Revenue from invoice schedule
              for (const inv of invoices) {
                const dateStr = inv.invoiced ? (inv.actual_date ?? inv.planned_date) : inv.planned_date;
                if (!dateStr) continue;
                const [y, m] = dateStr.split("-");
                const label = new Date(Number(y), Number(m) - 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
                if (!cfMonths.has(label)) cfMonths.set(label, { costsOut: 0, revenueIn: 0 });
                cfMonths.get(label)!.revenueIn += inv.invoiced ? (inv.actual_amount ?? inv.planned_amount) : inv.planned_amount;
              }

              // Sort and calculate cumulative
              const allLabels = Array.from(cfMonths.keys());
              let cumCosts = 0;
              let cumRevenue = 0;
              const cfData = allLabels.map((label) => {
                const d = cfMonths.get(label)!;
                cumCosts += d.costsOut;
                cumRevenue += d.revenueIn;
                return {
                  month: label,
                  "Costs Out": d.costsOut,
                  "Revenue In": d.revenueIn,
                  "Cumulative Costs": Math.round(cumCosts * 100) / 100,
                  "Cumulative Revenue": Math.round(cumRevenue * 100) / 100,
                  "Net Position": Math.round((cumRevenue - cumCosts) * 100) / 100,
                };
              });

              return cfData.length > 0 || invoices.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={350}>
                    <ComposedChart data={cfData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(value: number, name: string) => [`£${value.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, name]} />
                      <Legend />
                      <Bar yAxisId="left" dataKey="Costs Out" fill="#dc2626" opacity={0.7} />
                      <Bar yAxisId="left" dataKey="Revenue In" fill="#15803d" opacity={0.7} />
                      <Line yAxisId="right" type="monotone" dataKey="Net Position" stroke="#061b37" strokeWidth={2} dot={{ r: 3 }} />
                      <ReferenceLine yAxisId="right" y={0} stroke="#9ca3af" strokeDasharray="4 4" />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="text-xs text-gray-500 mt-2">
                    Bars show monthly costs (red) and invoiced/planned revenue (green). Line shows cumulative net cash position.
                    {invoices.length === 0 && <span className="text-amber-500 ml-1">Set up invoice milestones on the project detail page for revenue data.</span>}
                  </div>
                </>
              ) : (
                <div className="text-center text-gray-400 py-8">
                  No cost or invoice data available. Set up invoice milestones on the <a href={`/operations/projects/${selectedProject}`} className="text-blue-600 hover:underline">project detail page</a>.
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* EVM Legend */}
      <div className="mt-6 border rounded p-4 bg-gray-50 text-xs text-gray-600">
        <h3 className="font-semibold text-sm mb-2">EVM Metrics Reference</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div><strong>BAC</strong> — Budget at Completion (est. total cost)</div>
          <div><strong>PV</strong> — Planned Value (budget × planned % at today)</div>
          <div><strong>EV</strong> — Earned Value (budget × actual % complete)</div>
          <div><strong>AC</strong> — Actual Cost (labour + materials to date)</div>
          <div><strong>CPI</strong> — Cost Performance Index (EV/AC, &gt;1 = good)</div>
          <div><strong>SPI</strong> — Schedule Performance Index (EV/PV, &gt;1 = good)</div>
          <div><strong>CV</strong> — Cost Variance (EV − AC)</div>
          <div><strong>SV</strong> — Schedule Variance (EV − PV)</div>
          <div><strong>EAC</strong> — Estimate at Completion (AC + ETC)</div>
          <div><strong>ETC</strong> — Estimate to Complete (PM or BAC/CPI − AC)</div>
          <div><strong>VAC</strong> — Variance at Completion (BAC − EAC)</div>
          <div><strong>TCPI</strong> — To Complete Performance Index (&gt;1 = need more efficiency)</div>
          <div><strong>Budget Health</strong> — % budget spent vs % complete (Good/Watch/Over)</div>
        </div>
      </div>
    </div>
  );
}
