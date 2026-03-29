"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";

type ProjectItem = {
  id: string;
  projectnumber: string;
  item_seq: number;
  line_desc: string;
  value: number;
  est_labour: number;
  est_materials: number;
  completed: boolean;
};

type Commercial = {
  projectnumber: string;
  item_seq: number;
  pct_complete: number;
  planned_start_date: string | null;
  planned_completion_date: string | null;
  actual_start_date: string | null;
  notes: string | null;
};

type InvoiceMilestone = {
  id: string;
  projectnumber: string;
  item_seq: number;
  project_item_id: string;
  milestone: string;
  planned_date: string | null;
  planned_amount: number;
  invoiced: boolean;
  invoice_reference: string | null;
  actual_date: string | null;
  actual_amount: number | null;
  sort_order: number;
};

export default function ProjectDetailPage() {
  const params = useParams();
  const projectnumber = params.projectnumber as string;
  const { user, loading: authLoading } = useAuth();

  const [items, setItems] = useState<ProjectItem[]>([]);
  const [commercial, setCommercial] = useState<Map<string, Commercial>>(new Map());
  const [milestones, setMilestones] = useState<InvoiceMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "schedule" | "invoicing">("overview");

  // Load data
  useEffect(() => {
    if (!projectnumber) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Project items
      const { data: itemData } = await supabase
        .from("project_register_items")
        .select("id, projectnumber, item_seq, line_desc, value, est_labour, est_materials, completed")
        .eq("projectnumber", projectnumber)
        .order("item_seq");
      if (cancelled) return;

      const projectItems: ProjectItem[] = (itemData ?? []).map((r) => ({
        id: r.id,
        projectnumber: r.projectnumber,
        item_seq: r.item_seq,
        line_desc: r.line_desc,
        value: Number(r.value) || 0,
        est_labour: Number(r.est_labour) || 0,
        est_materials: Number(r.est_materials) || 0,
        completed: !!r.completed,
      }));
      setItems(projectItems);

      // Commercial data
      const { data: commData } = await supabase
        .from("project_items_commercial")
        .select("projectnumber, item_seq, pct_complete, planned_start_date, planned_completion_date, actual_start_date, notes")
        .eq("projectnumber", projectnumber);
      if (cancelled) return;

      const commMap = new Map<string, Commercial>();
      for (const r of commData ?? []) {
        commMap.set(`${r.projectnumber}-${String(r.item_seq).padStart(2, "0")}`, r as Commercial);
      }
      setCommercial(commMap);

      // Invoice milestones
      const { data: msData } = await supabase
        .from("project_invoice_schedule")
        .select("*")
        .eq("projectnumber", projectnumber)
        .order("item_seq")
        .order("sort_order");
      if (cancelled) return;
      setMilestones((msData ?? []) as InvoiceMilestone[]);

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectnumber]);

  // Save estimate field
  const saveEstimate = useCallback(async (itemId: string, field: "est_labour" | "est_materials", value: number) => {
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, [field]: value } : i));
    await supabase.from("project_register_items").update({ [field]: value }).eq("id", itemId);
  }, []);

  // Save commercial field
  const saveCommercial = useCallback(async (item: ProjectItem, field: keyof Commercial, value: string | number | null) => {
    const key = `${item.projectnumber}-${String(item.item_seq).padStart(2, "0")}`;
    const existing = commercial.get(key);
    const updated = {
      projectnumber: item.projectnumber,
      item_seq: item.item_seq,
      pct_complete: existing?.pct_complete ?? 0,
      planned_start_date: existing?.planned_start_date ?? null,
      planned_completion_date: existing?.planned_completion_date ?? null,
      actual_start_date: existing?.actual_start_date ?? null,
      notes: existing?.notes ?? null,
      [field]: value,
    };

    setCommercial((prev) => {
      const next = new Map(prev);
      next.set(key, updated);
      return next;
    });

    await supabase.from("project_items_commercial").upsert(
      { project_item_id: item.id, ...updated },
      { onConflict: "projectnumber,item_seq" }
    );
  }, [commercial]);

  // Add invoice milestone
  const addMilestone = useCallback(async (item: ProjectItem) => {
    const sortOrder = milestones.filter((m) => m.item_seq === item.item_seq).length;
    const { data } = await supabase.from("project_invoice_schedule").insert({
      project_item_id: item.id,
      projectnumber: item.projectnumber,
      item_seq: item.item_seq,
      milestone: "",
      planned_amount: 0,
      sort_order: sortOrder,
    }).select().single();
    if (data) setMilestones((prev) => [...prev, data as InvoiceMilestone]);
  }, [milestones]);

  // Update milestone field
  const updateMilestone = useCallback(async (id: string, field: string, value: string | number | boolean | null) => {
    setMilestones((prev) => prev.map((m) => m.id === id ? { ...m, [field]: value } : m));
    await supabase.from("project_invoice_schedule").update({ [field]: value }).eq("id", id);
  }, []);

  // Delete milestone
  const deleteMilestone = useCallback(async (id: string) => {
    setMilestones((prev) => prev.filter((m) => m.id !== id));
    await supabase.from("project_invoice_schedule").delete().eq("id", id);
  }, []);

  const fmtC = (v: number) =>
    `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Totals
  const totalContractValue = items.reduce((s, i) => s + i.value, 0);
  const totalEstLabour = items.reduce((s, i) => s + i.est_labour, 0);
  const totalEstMaterials = items.reduce((s, i) => s + i.est_materials, 0);
  const totalEstCost = totalEstLabour + totalEstMaterials;
  const totalPlannedInvoice = milestones.reduce((s, m) => s + m.planned_amount, 0);
  const totalActualInvoice = milestones.filter((m) => m.invoiced).reduce((s, m) => s + (m.actual_amount ?? m.planned_amount), 0);
  const invoiceCoverage = totalContractValue > 0 ? (totalPlannedInvoice / totalContractValue) * 100 : 0;

  // Editable cell
  const EditCell = ({ value, onSave, type = "number", step, min, max, placeholder, className = "" }: {
    value: string | number | null;
    onSave: (v: string) => void;
    type?: string;
    step?: string;
    min?: string;
    max?: string;
    placeholder?: string;
    className?: string;
  }) => {
    const [editing, setEditing] = useState(false);
    const [inputVal, setInputVal] = useState(String(value ?? ""));

    if (editing) {
      return (
        <input
          type={type}
          step={step}
          min={min}
          max={max}
          autoFocus
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={() => { setEditing(false); onSave(inputVal); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className={`border rounded px-2 py-1 text-sm w-full ${className}`}
        />
      );
    }
    return (
      <span
        onClick={() => { setEditing(true); setInputVal(String(value ?? "")); }}
        className={`cursor-pointer hover:bg-blue-50 px-2 py-1 rounded block ${className}`}
        title="Click to edit"
      >
        {value ? String(value) : <span className="text-gray-300">{placeholder ?? "–"}</span>}
      </span>
    );
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Project Detail</h1>
        <p className="text-gray-600">Sign in to view project data</p>
        <AuthButton redirectTo={`/operations/projects/${projectnumber}`} />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <a href="/operations/" className="text-gray-400 hover:text-gray-600 text-sm">&larr; Back</a>
        <div>
          <h1 className="text-xl font-semibold font-mono">{projectnumber}</h1>
          <p className="text-sm text-gray-500">{items[0]?.line_desc ?? ""}</p>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="border rounded p-3 bg-white">
            <div className="text-xs text-gray-500 uppercase">Contract Value</div>
            <div className="text-lg font-bold mt-1">{fmtC(totalContractValue)}</div>
          </div>
          <div className="border rounded p-3 bg-white">
            <div className="text-xs text-gray-500 uppercase">Est. Total Cost</div>
            <div className={`text-lg font-bold mt-1 ${totalEstCost > 0 ? "" : "text-amber-500"}`}>
              {totalEstCost > 0 ? fmtC(totalEstCost) : "Not set"}
            </div>
          </div>
          <div className="border rounded p-3 bg-white">
            <div className="text-xs text-gray-500 uppercase">Planned Margin</div>
            <div className={`text-lg font-bold mt-1 ${totalEstCost > 0 ? (totalContractValue - totalEstCost >= 0 ? "text-green-700" : "text-red-600") : "text-gray-400"}`}>
              {totalEstCost > 0 ? fmtC(totalContractValue - totalEstCost) : "–"}
            </div>
          </div>
          <div className="border rounded p-3 bg-white">
            <div className="text-xs text-gray-500 uppercase">Invoice Coverage</div>
            <div className={`text-lg font-bold mt-1 ${invoiceCoverage >= 99 ? "text-green-700" : invoiceCoverage > 0 ? "text-amber-600" : "text-gray-400"}`}>
              {invoiceCoverage > 0 ? `${invoiceCoverage.toFixed(0)}%` : "No schedule"}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b mb-6">
        {(["overview", "schedule", "invoicing"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium cursor-pointer border-b-2 -mb-px ${activeTab === tab ? "border-[#061b37] text-[#061b37]" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {tab === "overview" ? "Estimates & Progress" : tab === "schedule" ? "Schedule" : "Invoice Schedule"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-4">Loading project data...</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 py-8 text-center border rounded">No project items found</div>
      ) : (
        <>
          {/* Tab: Estimates & Progress */}
          {activeTab === "overview" && (
            <div className="border rounded overflow-auto">
              <table className="border-collapse text-sm w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border px-3 py-2 text-left min-w-28">Item</th>
                    <th className="border px-3 py-2 text-left min-w-48">Description</th>
                    <th className="border px-3 py-2 text-right min-w-28">Value</th>
                    <th className="border px-3 py-2 text-right min-w-28 bg-blue-50">Est. Labour</th>
                    <th className="border px-3 py-2 text-right min-w-28 bg-blue-50">Est. Materials</th>
                    <th className="border px-3 py-2 text-right min-w-28">Est. Total</th>
                    <th className="border px-3 py-2 text-right min-w-20">% Complete</th>
                    <th className="border px-3 py-2 text-center min-w-20">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const key = `${item.projectnumber}-${String(item.item_seq).padStart(2, "0")}`;
                    const comm = commercial.get(key);
                    const estTotal = item.est_labour + item.est_materials;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="border px-3 py-1.5 font-mono text-xs font-medium">
                          {item.projectnumber}-{String(item.item_seq).padStart(2, "0")}
                        </td>
                        <td className="border px-3 py-1.5 text-xs text-gray-600">{item.line_desc}</td>
                        <td className="border px-3 py-1.5 text-right">{fmtC(item.value)}</td>
                        <td className="border px-3 py-1.5 bg-blue-50/30">
                          <EditCell
                            value={item.est_labour || ""}
                            onSave={(v) => saveEstimate(item.id, "est_labour", parseFloat(v) || 0)}
                            step="0.01"
                            placeholder="set"
                            className="text-right"
                          />
                        </td>
                        <td className="border px-3 py-1.5 bg-blue-50/30">
                          <EditCell
                            value={item.est_materials || ""}
                            onSave={(v) => saveEstimate(item.id, "est_materials", parseFloat(v) || 0)}
                            step="0.01"
                            placeholder="set"
                            className="text-right"
                          />
                        </td>
                        <td className="border px-3 py-1.5 text-right">{estTotal > 0 ? fmtC(estTotal) : "–"}</td>
                        <td className="border px-3 py-1.5">
                          <EditCell
                            value={comm?.pct_complete || ""}
                            onSave={(v) => saveCommercial(item, "pct_complete", Math.max(0, Math.min(100, Math.round(parseFloat(v) || 0))))}
                            min="0"
                            max="100"
                            placeholder="set %"
                            className="text-right"
                          />
                        </td>
                        <td className="border px-3 py-1.5 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded ${item.completed ? "bg-gray-200 text-gray-600" : "bg-green-100 text-green-700"}`}>
                            {item.completed ? "Completed" : "Live"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Totals */}
                  <tr className="bg-gray-50 font-medium">
                    <td className="border px-3 py-2" colSpan={2}>Totals</td>
                    <td className="border px-3 py-2 text-right font-bold">{fmtC(totalContractValue)}</td>
                    <td className="border px-3 py-2 text-right">{fmtC(totalEstLabour)}</td>
                    <td className="border px-3 py-2 text-right">{fmtC(totalEstMaterials)}</td>
                    <td className="border px-3 py-2 text-right font-bold">{fmtC(totalEstCost)}</td>
                    <td className="border px-3 py-2" colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Tab: Schedule */}
          {activeTab === "schedule" && (
            <div className="border rounded overflow-auto">
              <table className="border-collapse text-sm w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border px-3 py-2 text-left min-w-28">Item</th>
                    <th className="border px-3 py-2 text-left min-w-48">Description</th>
                    <th className="border px-3 py-2 text-center min-w-32">Planned Start</th>
                    <th className="border px-3 py-2 text-center min-w-32">Planned Completion</th>
                    <th className="border px-3 py-2 text-center min-w-32">Actual Start</th>
                    <th className="border px-3 py-2 text-left min-w-48">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const key = `${item.projectnumber}-${String(item.item_seq).padStart(2, "0")}`;
                    const comm = commercial.get(key);
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="border px-3 py-1.5 font-mono text-xs font-medium">
                          {item.projectnumber}-{String(item.item_seq).padStart(2, "0")}
                        </td>
                        <td className="border px-3 py-1.5 text-xs text-gray-600">{item.line_desc}</td>
                        <td className="border px-3 py-1.5">
                          <EditCell
                            value={comm?.planned_start_date || ""}
                            onSave={(v) => saveCommercial(item, "planned_start_date", v || null)}
                            type="date"
                            placeholder="set date"
                            className="text-center"
                          />
                        </td>
                        <td className="border px-3 py-1.5">
                          <EditCell
                            value={comm?.planned_completion_date || ""}
                            onSave={(v) => saveCommercial(item, "planned_completion_date", v || null)}
                            type="date"
                            placeholder="set date"
                            className="text-center"
                          />
                        </td>
                        <td className="border px-3 py-1.5">
                          <EditCell
                            value={comm?.actual_start_date || ""}
                            onSave={(v) => saveCommercial(item, "actual_start_date", v || null)}
                            type="date"
                            placeholder="set date"
                            className="text-center"
                          />
                        </td>
                        <td className="border px-3 py-1.5">
                          <EditCell
                            value={comm?.notes || ""}
                            onSave={(v) => saveCommercial(item, "notes", v || null)}
                            type="text"
                            placeholder="add notes"
                            className="text-left"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab: Invoice Schedule */}
          {activeTab === "invoicing" && (
            <div>
              {/* Coverage bar */}
              <div className="mb-4 border rounded p-3 bg-white">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span>Invoice coverage: {fmtC(totalPlannedInvoice)} of {fmtC(totalContractValue)}</span>
                  <span className={`font-medium ${invoiceCoverage >= 99 ? "text-green-700" : invoiceCoverage > 0 ? "text-amber-600" : "text-gray-400"}`}>
                    {invoiceCoverage.toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded h-2">
                  <div
                    className={`h-2 rounded ${invoiceCoverage >= 99 ? "bg-green-500" : "bg-amber-500"}`}
                    style={{ width: `${Math.min(invoiceCoverage, 100)}%` }}
                  />
                </div>
                {Math.abs(totalPlannedInvoice - totalContractValue) > 0.01 && totalPlannedInvoice > 0 && (
                  <div className="text-xs text-amber-600 mt-1">
                    Difference: {fmtC(totalContractValue - totalPlannedInvoice)}
                  </div>
                )}
              </div>

              {items.map((item) => {
                const itemKey = `${item.projectnumber}-${String(item.item_seq).padStart(2, "0")}`;
                const itemMilestones = milestones.filter((m) => m.item_seq === item.item_seq);
                const itemInvoiceTotal = itemMilestones.reduce((s, m) => s + m.planned_amount, 0);

                return (
                  <div key={item.id} className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-mono text-sm font-medium">{itemKey}</span>
                        <span className="text-xs text-gray-500 ml-2">{item.line_desc}</span>
                        <span className="text-xs text-gray-400 ml-2">
                          (Value: {fmtC(item.value)} | Scheduled: {fmtC(itemInvoiceTotal)})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => addMilestone(item)}
                        className="text-xs rounded border px-2 py-1 hover:bg-gray-100 cursor-pointer"
                      >
                        + Add milestone
                      </button>
                    </div>

                    {itemMilestones.length > 0 ? (
                      <table className="border-collapse text-sm w-full mb-2">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="border px-3 py-1.5 text-left min-w-48">Milestone</th>
                            <th className="border px-3 py-1.5 text-center min-w-28">Planned Date</th>
                            <th className="border px-3 py-1.5 text-right min-w-28">Planned Amount</th>
                            <th className="border px-3 py-1.5 text-center min-w-20">Invoiced</th>
                            <th className="border px-3 py-1.5 text-left min-w-28">Invoice Ref</th>
                            <th className="border px-3 py-1.5 text-center min-w-28">Actual Date</th>
                            <th className="border px-3 py-1.5 text-right min-w-28">Actual Amount</th>
                            <th className="border px-3 py-1.5 text-center min-w-12"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemMilestones.map((ms) => (
                            <tr key={ms.id} className="hover:bg-gray-50">
                              <td className="border px-3 py-1">
                                <EditCell
                                  value={ms.milestone}
                                  onSave={(v) => updateMilestone(ms.id, "milestone", v)}
                                  type="text"
                                  placeholder="Milestone description"
                                  className="text-left"
                                />
                              </td>
                              <td className="border px-3 py-1">
                                <EditCell
                                  value={ms.planned_date || ""}
                                  onSave={(v) => updateMilestone(ms.id, "planned_date", v || null)}
                                  type="date"
                                  className="text-center"
                                />
                              </td>
                              <td className="border px-3 py-1">
                                <EditCell
                                  value={ms.planned_amount || ""}
                                  onSave={(v) => updateMilestone(ms.id, "planned_amount", parseFloat(v) || 0)}
                                  step="0.01"
                                  placeholder="0.00"
                                  className="text-right"
                                />
                              </td>
                              <td className="border px-3 py-1 text-center">
                                <input
                                  type="checkbox"
                                  checked={ms.invoiced}
                                  onChange={(e) => updateMilestone(ms.id, "invoiced", e.target.checked)}
                                  className="cursor-pointer"
                                />
                              </td>
                              <td className="border px-3 py-1">
                                <EditCell
                                  value={ms.invoice_reference || ""}
                                  onSave={(v) => updateMilestone(ms.id, "invoice_reference", v || null)}
                                  type="text"
                                  placeholder="ref"
                                  className="text-left"
                                />
                              </td>
                              <td className="border px-3 py-1">
                                <EditCell
                                  value={ms.actual_date || ""}
                                  onSave={(v) => updateMilestone(ms.id, "actual_date", v || null)}
                                  type="date"
                                  className="text-center"
                                />
                              </td>
                              <td className="border px-3 py-1">
                                <EditCell
                                  value={ms.actual_amount ?? ""}
                                  onSave={(v) => updateMilestone(ms.id, "actual_amount", parseFloat(v) || null)}
                                  step="0.01"
                                  placeholder="—"
                                  className="text-right"
                                />
                              </td>
                              <td className="border px-3 py-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => deleteMilestone(ms.id)}
                                  className="text-red-400 hover:text-red-600 cursor-pointer text-xs"
                                  title="Delete milestone"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-xs text-gray-400 border rounded px-3 py-2 mb-2">
                        No milestones — click "+ Add milestone" to create one
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
