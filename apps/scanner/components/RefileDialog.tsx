"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@platform/supabase/client";

const DOC_SERVICE_URL = process.env.NEXT_PUBLIC_DOC_SERVICE_URL ?? "";

type FilingRule = { type_code: string; document_type: string };
type Asset = { asset_code: string; asset_name: string };
type DocDef = { doc_code: string; doc_name: string; type_code: string; meta_required: boolean };
type MetaField = { field_name: string; field_label: string; field_type: string; required: boolean; sort_order: number };
type Supplier = { id: string; name: string };
type SupplierEmployee = { id: number; employee_name: string };

type Props = {
  jobId: string;
  errorCode?: string | null;
  initialTypeCode: string | null;
  initialAssetCode: string | null;
  initialDocCode: string | null;
  initialPeriod: string | null;
  onClose: () => void;
  onRefiled: () => void;
};

function getRecentWeeks(count: number): string[] {
  const weeks: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const days = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
    const week = Math.ceil((days + jan1.getDay() + 1) / 7);
    weeks.push(`${year}-W${String(week).padStart(2, "0")}`);
  }
  return weeks;
}

export function RefileDialog({
  jobId,
  errorCode,
  initialTypeCode,
  initialAssetCode,
  initialDocCode,
  initialPeriod,
  onClose,
  onRefiled,
}: Props) {
  const [typeCode, setTypeCode] = useState(initialTypeCode ?? "");
  const [assetCode, setAssetCode] = useState(initialAssetCode ?? "");
  const [docCode, setDocCode] = useState(initialDocCode ?? "");
  const [period, setPeriod] = useState(initialPeriod ?? "");
  const [skipDuplicate, setSkipDuplicate] = useState(false);

  const [filingRules, setFilingRules] = useState<FilingRule[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [docDefs, setDocDefs] = useState<DocDef[]>([]);
  const [filedPeriods, setFiledPeriods] = useState<string[]>([]);

  // Meta fields
  const [metaFields, setMetaFields] = useState<MetaField[]>([]);
  const [metaValues, setMetaValues] = useState<Record<string, unknown>>({});

  // Supplier/employee data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierEmployees, setSupplierEmployees] = useState<SupplierEmployee[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMetaRequired = errorCode === "META_REQUIRED";

  // Load lookup data
  useEffect(() => {
    supabase
      .from("document_filing_rule")
      .select("type_code, document_type")
      .eq("active", true)
      .order("type_code")
      .then(({ data }) => setFilingRules(data ?? []));

    supabase
      .from("asset_register")
      .select("asset_code, asset_name")
      .eq("active", true)
      .order("asset_code")
      .then(({ data }) => setAssets(data ?? []));

    supabase
      .from("document_definition")
      .select("doc_code, doc_name, type_code, meta_required")
      .eq("active", true)
      .order("doc_code")
      .then(({ data }) => setDocDefs(data ?? []));

    supabase
      .from("suppliers")
      .select("id, name")
      .order("name")
      .then(({ data }) => setSuppliers(data ?? []));
  }, []);

  // Load meta fields when doc code changes
  useEffect(() => {
    if (!docCode) {
      setMetaFields([]);
      return;
    }
    supabase
      .from("document_definition_meta")
      .select("field_name, field_label, field_type, required, sort_order")
      .eq("doc_code", docCode)
      .order("sort_order")
      .then(({ data }) => setMetaFields(data ?? []));
  }, [docCode]);

  // Load supplier employees when supplier changes
  const supplierId = metaValues.supplier_id as string | undefined;
  useEffect(() => {
    if (!supplierId) {
      setSupplierEmployees([]);
      setSelectedEmployeeIds([]);
      return;
    }
    supabase
      .from("supplier_employee")
      .select("id, employee_name")
      .eq("supplier_id", supplierId)
      .eq("active", true)
      .order("employee_name")
      .then(({ data }) => setSupplierEmployees(data ?? []));
  }, [supplierId]);

  // Filter doc codes by selected type code
  const filteredDocDefs = typeCode
    ? docDefs.filter((d) => d.type_code === typeCode)
    : docDefs;

  // Query filed periods when asset/doc/type change
  const fetchFiledPeriods = useCallback(async () => {
    if (!assetCode || !docCode) {
      setFiledPeriods([]);
      return;
    }
    const { data } = await supabase
      .from("document_incoming_scan")
      .select("period")
      .eq("asset_code", assetCode)
      .eq("doc_code", docCode)
      .eq("status", "filed")
      .not("period", "is", null);
    setFiledPeriods((data ?? []).map((r) => r.period as string));
  }, [assetCode, docCode]);

  useEffect(() => {
    fetchFiledPeriods();
  }, [fetchFiledPeriods]);

  const allWeeks = getRecentWeeks(12);
  const availableWeeks = skipDuplicate
    ? allWeeks
    : allWeeks.filter((w) => !filedPeriods.includes(w));

  const toggleEmployee = (id: number) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);

    // Build metadata payload
    const metadata: Record<string, unknown> = { ...metaValues };
    if (selectedEmployeeIds.length > 0) {
      metadata.employee_ids = selectedEmployeeIds;
    }

    try {
      const res = await fetch(`${DOC_SERVICE_URL}/api/scan/${jobId}/refile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type_code: typeCode,
          asset_code: assetCode,
          doc_code: docCode,
          period,
          skip_duplicate_check: skipDuplicate,
          meta: Object.keys(metadata).length > 0 ? metadata : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.details?.join(", ") ?? data.error ?? "Refile failed");
        return;
      }

      // Update supplier_employee induction records
      if (selectedEmployeeIds.length > 0) {
        for (const empId of selectedEmployeeIds) {
          await supabase
            .from("supplier_employee")
            .update({
              induction_date: new Date().toISOString().split("T")[0],
              induction_scan_id: jobId,
            })
            .eq("id", empId);
        }
      }

      onRefiled();
    } catch {
      setError("Failed to connect to document service");
    } finally {
      setSubmitting(false);
    }
  };

  const hasRequiredMeta = metaFields.length === 0 || metaFields.every((f) => {
    if (!f.required) return true;
    if (f.field_type === "supplier") return !!metaValues.supplier_id;
    if (f.field_type === "supplier_employees") return selectedEmployeeIds.length > 0;
    return !!metaValues[f.field_name];
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--pss-navy)" }}>
          {isMetaRequired ? "Complete Document Information" : "Refile Document"}
        </h3>
        {isMetaRequired && (
          <p className="text-sm text-amber-600 mb-4">
            This document requires additional information before it can be filed.
          </p>
        )}

        <div className="space-y-3">
          {/* Type Code */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type Code</label>
            <select
              value={typeCode}
              onChange={(e) => {
                setTypeCode(e.target.value);
                setDocCode("");
                setPeriod("");
                setMetaValues({});
                setSelectedEmployeeIds([]);
              }}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Select type...</option>
              {filingRules.map((r) => (
                <option key={r.type_code} value={r.type_code}>
                  {r.type_code} — {r.document_type}
                </option>
              ))}
            </select>
          </div>

          {/* Asset Code */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Asset</label>
            <select
              value={assetCode}
              onChange={(e) => {
                setAssetCode(e.target.value);
                setPeriod("");
              }}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Select asset...</option>
              {assets.map((a) => (
                <option key={a.asset_code} value={a.asset_code}>
                  {a.asset_code} — {a.asset_name}
                </option>
              ))}
            </select>
          </div>

          {/* Doc Code */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Document</label>
            <select
              value={docCode}
              onChange={(e) => {
                setDocCode(e.target.value);
                setPeriod("");
                setMetaValues({});
                setSelectedEmployeeIds([]);
              }}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Select document...</option>
              {filteredDocDefs.map((d) => (
                <option key={d.doc_code} value={d.doc_code}>
                  {d.doc_code} — {d.doc_name}
                </option>
              ))}
            </select>
          </div>

          {/* Period */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Period
              {filedPeriods.length > 0 && (
                <span className="text-gray-400 font-normal ml-1">
                  ({filedPeriods.length} already filed)
                </span>
              )}
            </label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Select week...</option>
              {availableWeeks.map((w) => (
                <option key={w} value={w}>
                  {w}
                  {filedPeriods.includes(w) ? " (already filed)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Dynamic meta fields */}
          {metaFields.map((field) => {
            if (field.field_type === "supplier") {
              return (
                <div key={field.field_name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.field_label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <select
                    value={(metaValues.supplier_id as string) ?? ""}
                    onChange={(e) => {
                      setMetaValues((prev) => ({ ...prev, supplier_id: e.target.value || undefined }));
                      setSelectedEmployeeIds([]);
                    }}
                    className="w-full border rounded px-3 py-2 text-sm"
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            if (field.field_type === "supplier_employees") {
              if (!supplierId) return null;
              return (
                <div key={field.field_name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.field_label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                    {selectedEmployeeIds.length > 0 && (
                      <span className="text-gray-400 font-normal ml-1">
                        ({selectedEmployeeIds.length} selected)
                      </span>
                    )}
                  </label>
                  {supplierEmployees.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No employees registered for this supplier</p>
                  ) : (
                    <div className="border rounded max-h-40 overflow-y-auto">
                      {supplierEmployees.map((emp) => (
                        <label
                          key={emp.id}
                          className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 ${
                            selectedEmployeeIds.includes(emp.id) ? "bg-blue-50" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedEmployeeIds.includes(emp.id)}
                            onChange={() => toggleEmployee(emp.id)}
                            className="rounded"
                          />
                          {emp.employee_name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            // Default text field
            return (
              <div key={field.field_name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.field_label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type={field.field_type === "date" ? "date" : "text"}
                  value={(metaValues[field.field_name] as string) ?? ""}
                  onChange={(e) => setMetaValues((prev) => ({ ...prev, [field.field_name]: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
            );
          })}

          {/* Skip duplicate check */}
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={skipDuplicate}
              onChange={(e) => setSkipDuplicate(e.target.checked)}
              className="rounded"
            />
            Allow filing even if a document already exists for this period
          </label>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !typeCode || !assetCode || !docCode || !period || !hasRequiredMeta}
            className="px-4 py-2 text-sm text-white rounded disabled:opacity-50"
            style={{ backgroundColor: "var(--pss-navy)" }}
          >
            {submitting ? "Filing..." : isMetaRequired ? "Complete & File" : "Refile"}
          </button>
        </div>
      </div>
    </div>
  );
}
