"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@platform/supabase/client";

const DOC_SERVICE_URL = process.env.NEXT_PUBLIC_DOC_SERVICE_URL ?? "";

type FilingRule = { type_code: string; document_type: string };
type Asset = { asset_code: string; asset_name: string };
type DocDef = { doc_code: string; doc_name: string; type_code: string };

type Props = {
  jobId: string;
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

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      .select("doc_code, doc_name, type_code")
      .eq("active", true)
      .order("doc_code")
      .then(({ data }) => setDocDefs(data ?? []));
  }, []);

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

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.details?.join(", ") ?? data.error ?? "Refile failed");
        return;
      }
      onRefiled();
    } catch {
      setError("Failed to connect to document service");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--pss-navy)" }}>
          Refile Document
        </h3>

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
            disabled={submitting || !typeCode || !assetCode || !docCode || !period}
            className="px-4 py-2 text-sm text-white rounded disabled:opacity-50"
            style={{ backgroundColor: "var(--pss-navy)" }}
          >
            {submitting ? "Refiling..." : "Refile"}
          </button>
        </div>
      </div>
    </div>
  );
}
