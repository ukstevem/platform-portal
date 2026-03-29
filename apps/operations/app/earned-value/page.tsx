"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, Legend,
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
  eac: number;           // Estimate at Completion = BAC / CPI
  etc: number;           // Estimate to Complete = EAC - AC
  vac: number;           // Variance at Completion = BAC - EAC
};

function calcPlannedPct(plannedStart: string | null, plannedEnd: string | null): number {
  if (!plannedStart || !plannedEnd) return 0;
  const start = new Date(plannedStart).getTime();
  const end = new Date(plannedEnd).getTime();
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return ((now - start) / (end - start)) * 100;
}

export default function EarnedValuePage() {
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<ProjectEVM[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [monthlyData, setMonthlyData] = useState<Map<string, { month: string; ac: number; ev: number; pv: number }[]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const pageSize = 1000;

      // Fetch project register items (contract value + estimates)
      const projMap = new Map<string, { desc: string; contractValue: number; estCost: number }>();
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_register_items")
          .select("projectnumber, item_seq, line_desc, value, est_labour, est_materials")
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
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Fetch commercial data per item, then roll up to project level
      // Intermediate: per item data
      const itemCommercial = new Map<string, { pctComplete: number; estCost: number; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null }[]>();
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("project_items_commercial")
          .select("projectnumber, item_seq, pct_complete, planned_start_date, planned_completion_date, actual_start_date")
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
      const commercialMap = new Map<string, { pctComplete: number; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null }>();
      for (const [proj, items] of itemCommercial) {
        const avgPct = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.pctComplete, 0) / items.length) : 0;
        // Earliest planned start, latest planned end, earliest actual start
        const starts = items.map((i) => i.plannedStart).filter(Boolean) as string[];
        const ends = items.map((i) => i.plannedEnd).filter(Boolean) as string[];
        const actStarts = items.map((i) => i.actualStart).filter(Boolean) as string[];
        commercialMap.set(proj, {
          pctComplete: avgPct,
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

      // Fetch PO spend
      const poByProject = new Map<string, number>();
      const monthlyPO = new Map<string, Map<string, number>>();
      const poDateMap = new Map<number, string>();
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("purchase_orders")
          .select("po_number, created_at")
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const d of data) poDateMap.set(d.po_number, d.created_at);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      from = 0;
      while (true) {
        const { data } = await supabase
          .from("accounts_overview")
          .select("projectnumber, total_value, po_number")
          .range(from, from + pageSize - 1);
        if (cancelled) return;
        if (!data || data.length === 0) break;
        for (const d of data) {
          const val = Number(d.total_value) || 0;
          poByProject.set(d.projectnumber, (poByProject.get(d.projectnumber) ?? 0) + val);
          const month = (poDateMap.get(d.po_number) ?? "").slice(0, 7);
          if (month) {
            if (!monthlyPO.has(d.projectnumber)) monthlyPO.set(d.projectnumber, new Map());
            monthlyPO.get(d.projectnumber)!.set(month, (monthlyPO.get(d.projectnumber)!.get(month) ?? 0) + val);
          }
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
        const plannedPct = calcPlannedPct(commercial?.plannedStart ?? null, commercial?.plannedEnd ?? null);
        const pv = bac * (plannedPct / 100);

        const cv = ev - ac;
        const sv = ev - pv;
        const cpi = ac > 0 ? ev / ac : 0;
        const spi = pv > 0 ? ev / pv : 0;
        const eac = cpi > 0 ? bac / cpi : 0;
        const etc = eac - ac;
        const vac = bac - eac;

        summaries.push({
          projectnumber: proj,
          description: info.desc,
          bac,
          contractValue: info.contractValue,
          pctComplete,
          plannedStart: commercial?.plannedStart ?? null,
          plannedEnd: commercial?.plannedEnd ?? null,
          actualStart: commercial?.actualStart ?? null,
          ac, ev, pv, cv, sv, cpi, spi, eac, etc, vac,
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

          // PV: linear interpolation between start and end dates
          let pvAtMonth = 0;
          if (s.plannedStart && s.plannedEnd) {
            const [y, m] = month.split("-");
            const monthEnd = new Date(Number(y), Number(m), 0).getTime(); // last day of month
            const startT = new Date(s.plannedStart).getTime();
            const endT = new Date(s.plannedEnd).getTime();
            const pctTime = Math.max(0, Math.min(1, (monthEnd - startT) / (endT - startT)));
            pvAtMonth = s.bac * pctTime;
          }

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

      setProjects(summaries);
      setMonthlyData(mData);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const fmtC = (v: number) => {
    const abs = Math.abs(v);
    const str = `£${abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return v < 0 ? `-${str}` : str;
  };

  // Portfolio totals
  const totals = useMemo(() => {
    return projects.reduce(
      (acc, p) => ({
        bac: acc.bac + p.bac,
        ac: acc.ac + p.ac,
        ev: acc.ev + p.ev,
        pv: acc.pv + p.pv,
      }),
      { bac: 0, ac: 0, ev: 0, pv: 0 }
    );
  }, [projects]);

  const portfolioCPI = totals.ac > 0 ? totals.ev / totals.ac : 0;
  const portfolioSPI = totals.pv > 0 ? totals.ev / totals.pv : 0;
  const portfolioCV = totals.ev - totals.ac;
  const portfolioSV = totals.ev - totals.pv;

  const chartData = selectedProject ? (monthlyData.get(selectedProject) ?? []) : [];
  const selectedSummary = projects.find((p) => p.projectnumber === selectedProject);

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
      <h1 className="text-xl font-semibold mb-6">Earned Value Management</h1>

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
                <th className="border px-3 py-2 text-left min-w-48">Description</th>
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
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.projectnumber}
                  className={`hover:bg-gray-50 cursor-pointer ${selectedProject === p.projectnumber ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""}`}
                  onClick={() => setSelectedProject(selectedProject === p.projectnumber ? null : p.projectnumber)}
                >
                  <td className={`border px-3 py-1.5 font-mono text-xs font-medium sticky left-0 z-10 ${selectedProject === p.projectnumber ? "bg-blue-50" : "bg-white"}`}>
                    {p.projectnumber}
                  </td>
                  <td className="border px-3 py-1.5 text-xs text-gray-600 truncate max-w-64">{p.description}</td>
                  <td className="border px-3 py-1.5 text-right text-xs">
                    {p.pctComplete > 0 ? `${p.pctComplete}%` : <span className="text-amber-500 italic">set %</span>}
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
                  <td className={`border px-3 py-1.5 text-right ${p.etc >= 0 ? "" : "text-red-600"}`}>
                    {p.cpi > 0 ? fmtC(p.etc) : "–"}
                  </td>
                  <td className={`border px-3 py-1.5 text-right ${p.vac >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {p.cpi > 0 ? fmtC(p.vac) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* S-Curve chart for selected project */}
      {selectedProject && chartData.length > 0 && selectedSummary && (
        <div className="mt-6 border rounded p-4 bg-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">
                EVM S-Curve — {selectedProject} ({selectedSummary.description})
              </h2>
              <div className="text-xs text-gray-500 mt-1">
                BAC: {fmtC(selectedSummary.bac)} | % Complete: {selectedSummary.pctComplete}% |
                CPI: {selectedSummary.cpi > 0 ? selectedSummary.cpi.toFixed(2) : "N/A"} |
                SPI: {selectedSummary.spi > 0 ? selectedSummary.spi.toFixed(2) : "N/A"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedProject(null)}
              className="text-gray-400 hover:text-gray-600 text-xl cursor-pointer"
            >
              ✕
            </button>
          </div>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => `£${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(value: number, name: string) =>
                  [`£${value.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, name]
                }
              />
              <Legend />
              {selectedSummary.bac > 0 && (
                <ReferenceLine
                  y={selectedSummary.bac}
                  stroke="#9ca3af"
                  strokeDasharray="8 4"
                  label={{ value: `BAC ${fmtC(selectedSummary.bac)}`, position: "insideTopRight", fontSize: 11, fill: "#9ca3af" }}
                />
              )}
              {chartData.some((d) => d.pv > 0) && (
                <Line
                  type="monotone"
                  dataKey="pv"
                  name="Planned Value (PV)"
                  stroke="#6b7280"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 2 }}
                />
              )}
              <Line
                type="monotone"
                dataKey="ev"
                name="Earned Value (EV)"
                stroke="#15803d"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="ac"
                name="Actual Cost (AC)"
                stroke="#dc2626"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="text-xs text-gray-500 mt-2 space-y-1">
            <p><strong>EV above AC</strong> → under budget (CPI &gt; 1). <strong>AC above EV</strong> → over budget.</p>
            <p><strong>EV above PV</strong> → ahead of schedule (SPI &gt; 1). <strong>PV above EV</strong> → behind schedule.</p>
            {!selectedSummary.plannedStart && <p className="text-amber-500">Set planned start/completion dates in project commercial data for Planned Value (PV) calculation.</p>}
          </div>
        </div>
      )}

      {selectedProject && chartData.length === 0 && (
        <div className="mt-6 border rounded p-4 bg-white text-center text-gray-500">
          No spend data available for {selectedProject}
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
          <div><strong>EAC</strong> — Estimate at Completion (BAC/CPI)</div>
          <div><strong>ETC</strong> — Estimate to Complete (EAC − AC)</div>
          <div><strong>VAC</strong> — Variance at Completion (BAC − EAC)</div>
        </div>
      </div>
    </div>
  );
}
