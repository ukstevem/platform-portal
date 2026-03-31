"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";

type Asset = {
  id: number;
  asset_code: string;
  asset_name: string;
  category: string;
  location: string | null;
  doc_code: string | null;
  active: boolean;
};

type FilingRule = { type_code: string; document_type: string; description: string | null };
type DocDef = { doc_code: string; doc_name: string; type_code: string; category: string | null; interval_days: number | null; meta_required: boolean };

const AREAS = [
  { value: "HS", label: "Health & Safety", hint: "Risk assessments, inspections, RAMS, incident reports" },
  { value: "DR", label: "Drawing / Design", hint: "Drawing submissions, design reviews" },
  { value: "CR", label: "Correspondence", hint: "Letters, RFIs, transmittals" },
  { value: "MS", label: "Method Statement", hint: "Work procedures, method statements" },
  { value: "RP", label: "Report", hint: "Inspection reports, test reports" },
  { value: "SH", label: "Schedule", hint: "Delivery schedules, material schedules" },
  { value: "SN", label: "Specification", hint: "Technical specifications" },
  { value: "MR", label: "Meeting Record", hint: "Meeting minutes, toolbox talks" },
  { value: "DB", label: "Database / Register", hint: "Registers, logs, tracking documents" },
];

const INTERVALS = [
  { value: "", label: "No — one-off document" },
  { value: "1", label: "Daily" },
  { value: "7", label: "Weekly" },
  { value: "14", label: "Fortnightly" },
  { value: "30", label: "Monthly" },
  { value: "91", label: "Quarterly" },
  { value: "182", label: "6-monthly" },
  { value: "365", label: "Annually" },
];

export default function FormsPage() {
  const { user, loading: authLoading } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filingRules, setFilingRules] = useState<FilingRule[]>([]);
  const [docDefs, setDocDefs] = useState<DocDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  // Creation flow
  const [showForm, setShowForm] = useState(false);
  const [typeCode, setTypeCode] = useState("");
  const [area, setArea] = useState("");
  const [formName, setFormName] = useState("");
  const [docCode, setDocCode] = useState("");
  const [interval, setInterval_] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // QR
  const [qrAsset, setQrAsset] = useState<Asset | null>(null);
  const [qrDocCode, setQrDocCode] = useState("");

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from("asset_register")
      .select("id, asset_code, asset_name, category, location, doc_code, active")
      .like("category", "%-form")
      .order("asset_code");
    setAssets(data ?? []);
    setLoading(false);
  }, []);

  const fetchDocDefs = useCallback(async () => {
    const { data } = await supabase
      .from("document_definition")
      .select("doc_code, doc_name, type_code, category, interval_days, meta_required")
      .eq("active", true)
      .order("doc_code");
    setDocDefs(data ?? []);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchAssets();
    fetchDocDefs();
    supabase
      .from("document_filing_rule")
      .select("type_code, document_type, description")
      .eq("active", true)
      .order("type_code")
      .then(({ data }) => setFilingRules(data ?? []));
  }, [user, fetchAssets, fetchDocDefs]);

  const formCategories = [...new Set(assets.map((a) => a.category))].sort();

  const filtered = assets.filter((a) => {
    if (categoryFilter && a.category !== categoryFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (
        a.asset_code.toLowerCase().includes(q) ||
        a.asset_name.toLowerCase().includes(q) ||
        (a.location ?? "").toLowerCase().includes(q) ||
        (a.doc_code ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Auto-generate doc code from form name
  const autoDocCode = formName
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.substring(0, 3))
    .join("-")
    .substring(0, 20);

  const activeDocCode = docCode || autoDocCode;

  // Check for existing similar forms
  const existingMatch = docDefs.find(
    (d) => d.doc_code === activeDocCode || d.doc_name.toLowerCase() === formName.toLowerCase()
  );

  const existingAssetMatch = assets.find(
    (a) => a.doc_code === activeDocCode
  );

  const getNextSeq = (prefix: string): string => {
    const existing = assets
      .filter((a) => a.asset_code.startsWith(prefix + "-"))
      .map((a) => {
        const parts = a.asset_code.split("-");
        return parseInt(parts[parts.length - 1], 10);
      })
      .filter((n) => !isNaN(n));
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    return String(max + 1).padStart(3, "0");
  };

  const generatedAssetCode = area && activeDocCode
    ? `${area}-${activeDocCode}-${getNextSeq(`${area}-${activeDocCode}`)}`
    : "";

  const generatedCategory = area ? `${area.toLowerCase()}-form` : "";

  const qrPreview = typeCode && generatedAssetCode && activeDocCode
    ? `${typeCode}|${generatedAssetCode}|${activeDocCode}`
    : "";

  const resetForm = () => {
    setTypeCode("");
    setArea("");
    setFormName("");
    setDocCode("");
    setInterval_("");
    setLocation("");
    setFormError(null);
  };

  const handleSave = async () => {
    setFormError(null);
    if (!typeCode || !area || !formName || !activeDocCode) {
      setFormError("Please complete all required fields");
      return;
    }
    if (activeDocCode.includes("_")) {
      setFormError("Underscores are not allowed — reserved as field separators");
      return;
    }

    setSaving(true);

    // Create doc definition if it doesn't exist
    if (!existingMatch) {
      const { error } = await supabase.from("document_definition").insert({
        doc_code: activeDocCode,
        doc_name: formName,
        type_code: typeCode,
        category: generatedCategory,
        interval_days: interval ? parseInt(interval, 10) : null,
      });
      if (error) {
        setFormError(`Definition: ${error.message}`);
        setSaving(false);
        return;
      }
    }

    // Create form asset
    const { error } = await supabase.from("asset_register").insert({
      asset_code: generatedAssetCode,
      asset_name: formName,
      category: generatedCategory,
      location: location || null,
      doc_code: activeDocCode,
    });

    if (error) {
      setFormError(`Asset: ${error.message}`);
      setSaving(false);
      return;
    }

    resetForm();
    setShowForm(false);
    setSaving(false);
    fetchAssets();
    fetchDocDefs();
  };

  // QR rendering
  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas || !qrAsset) return;

    const ctx = canvas.getContext("2d")!;
    const size = 200;
    const padding = 20;
    const labelHeight = 40;
    canvas.width = size + padding * 2;
    canvas.height = size + padding * 2 + labelHeight;

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js";
    script.onload = () => {
      // @ts-expect-error - qrcode global from CDN
      const qr = qrcode(0, "M");
      const docDef = docDefs.find((d) => d.doc_code === qrDocCode);
      const tc = docDef?.type_code ?? qrAsset.asset_code.split("-")[0];
      const content = qrDocCode
        ? `${tc}|${qrAsset.asset_code}|${qrDocCode}`
        : qrAsset.asset_code;

      qr.addData(content);
      qr.make();

      const moduleCount = qr.getModuleCount();
      const cellSize = Math.floor(size / moduleCount);
      const offset = Math.floor((size - cellSize * moduleCount) / 2) + padding;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#000000";
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(row, col)) {
            ctx.fillRect(offset + col * cellSize, padding + row * cellSize, cellSize, cellSize);
          }
        }
      }

      ctx.fillStyle = "#000000";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      const label = qrDocCode
        ? `${qrAsset.asset_code} | ${qrDocCode}`
        : qrAsset.asset_code;
      ctx.fillText(label, canvas.width / 2, size + padding + 20);

      if (qrDocCode) {
        ctx.font = "9px sans-serif";
        ctx.fillStyle = "#666666";
        ctx.fillText(docDef?.doc_name ?? "", canvas.width / 2, size + padding + 34);
      }
    };
    document.head.appendChild(script);
  }, [qrAsset, qrDocCode, docDefs]);

  const downloadQR = () => {
    const canvas = document.querySelector<HTMLCanvasElement>("#qr-canvas");
    if (!canvas || !qrAsset) return;
    const link = document.createElement("a");
    const suffix = qrDocCode ? `_${qrDocCode}` : "";
    link.download = `${qrAsset.asset_code}${suffix}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const applicableDocDefs = qrAsset
    ? docDefs.filter((d) => {
        const prefix = qrAsset.asset_code.split("-")[0];
        return !d.category || d.category === qrAsset.category || d.type_code === prefix;
      })
    : [];

  const getLinkedDocDef = (asset: Asset): DocDef | undefined => {
    if (!asset.doc_code) return undefined;
    return docDefs.find((d) => d.doc_code === asset.doc_code);
  };

  if (authLoading) return <div className="p-6 text-gray-500">Loading...</div>;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-gray-600">Sign in to manage forms</p>
        <AuthButton redirectTo="/scanner/forms" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Form Templates" />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-48"
        />
        {formCategories.length > 1 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="">All form types</option>
            {formCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
          className="px-4 py-1.5 text-sm text-white rounded hover:opacity-90"
          style={{ backgroundColor: "var(--pss-navy)" }}
        >
          {showForm ? "Cancel" : "+ New Form"}
        </button>
        <span className="text-xs text-gray-400 self-center ml-auto">
          {filtered.length} of {assets.length}
        </span>
      </div>

      {/* Guided creation flow */}
      {showForm && (
        <div className="border rounded-lg p-5 mb-4 bg-gray-50 space-y-4">

          {/* Q1: What type of document is this? */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              What type of document is this?
            </label>
            <p className="text-xs text-gray-500 mb-2">e.g. a meeting record, a certificate, an inspection report</p>
            <select
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
              className="w-full md:w-1/2 border rounded px-3 py-2 text-sm"
            >
              <option value="">Select document type...</option>
              {filingRules.map((r) => (
                <option key={r.type_code} value={r.type_code}>
                  {r.type_code} — {r.document_type}
                </option>
              ))}
            </select>
          </div>

          {/* Q2: What area does this fall under? */}
          {typeCode && (
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                What area does this fall under?
              </label>
              <p className="text-xs text-gray-500 mb-2">This determines how the form is categorised and filed</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {AREAS.map((a) => (
                  <label
                    key={a.value}
                    className={`flex flex-col p-2 rounded border cursor-pointer text-sm ${
                      area === a.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="area"
                        value={a.value}
                        checked={area === a.value}
                        onChange={(e) => setArea(e.target.value)}
                      />
                      <span className="font-medium">{a.label}</span>
                    </div>
                    <span className="text-xs text-gray-400 ml-5">{a.hint}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Q3: What's it for? */}
          {typeCode && area && (
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                What is this form for?
              </label>
              <p className="text-xs text-gray-500 mb-2">e.g. Toolbox Talk, Weekly Inspection, Crane Pre-Use Check</p>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Enter a description..."
                className="w-full md:w-1/2 border rounded px-3 py-2 text-sm"
              />
            </div>
          )}

          {/* Auto-generated doc code + override */}
          {typeCode && area && formName && (
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Short code
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Auto-generated from the description — edit if you prefer something different
              </p>
              <input
                type="text"
                value={docCode || autoDocCode}
                onChange={(e) => setDocCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                className="w-48 border rounded px-3 py-2 text-sm font-mono font-bold"
              />
            </div>
          )}

          {/* Existing match warning */}
          {formName && existingMatch && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
              <strong>Similar form already exists:</strong>{" "}
              <span className="font-mono">{existingMatch.doc_code}</span> — {existingMatch.doc_name}
              {existingAssetMatch && (
                <span className="text-gray-500"> (asset: {existingAssetMatch.asset_code})</span>
              )}
              <p className="text-xs text-amber-600 mt-1">
                Consider using the existing form rather than creating a duplicate.
              </p>
            </div>
          )}

          {/* Q4: Repeating? */}
          {typeCode && area && formName && activeDocCode && (
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Is this a repeating document?
              </label>
              <select
                value={interval}
                onChange={(e) => setInterval_(e.target.value)}
                className="w-full md:w-1/3 border rounded px-3 py-2 text-sm"
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Location */}
          {typeCode && area && formName && activeDocCode && (
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Location / site <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Carrwood Road"
                className="w-full md:w-1/3 border rounded px-3 py-2 text-sm"
              />
            </div>
          )}

          {/* Summary + save */}
          {typeCode && area && formName && activeDocCode && (
            <div className="border-t pt-4 mt-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                <div>
                  <span className="text-gray-500">Form code</span>
                  <p className="font-mono font-bold text-sm">{generatedAssetCode}</p>
                </div>
                <div>
                  <span className="text-gray-500">Doc definition</span>
                  <p className="font-mono font-bold text-sm">{activeDocCode}</p>
                </div>
                <div>
                  <span className="text-gray-500">ISO type</span>
                  <p className="font-mono font-bold text-sm">{typeCode}</p>
                </div>
                <div>
                  <span className="text-gray-500">QR content</span>
                  <p className="font-mono text-sm">{qrPreview}</p>
                </div>
              </div>

              {formError && <p className="text-red-600 text-sm mb-2">{formError}</p>}

              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm text-white rounded disabled:opacity-50 hover:opacity-90"
                style={{ backgroundColor: "var(--pss-navy)" }}
              >
                {saving ? "Creating..." : "Create Form"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">No form templates found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Description</th>
                <th className="py-2 pr-4 font-medium">Document</th>
                <th className="py-2 pr-4 font-medium">ISO Type</th>
                <th className="py-2 pr-4 font-medium">Location</th>
                <th className="py-2 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => {
                const linked = getLinkedDocDef(asset);
                return (
                  <tr
                    key={asset.id}
                    className={`border-b last:border-0 hover:bg-gray-50 ${!asset.active ? "opacity-40" : ""}`}
                  >
                    <td className="py-2 pr-4 font-mono text-xs font-bold">{asset.asset_code}</td>
                    <td className="py-2 pr-4">{asset.asset_name}</td>
                    <td className="py-2 pr-4 text-xs">
                      {linked ? (
                        <span>
                          <span className="font-mono font-bold">{linked.doc_code}</span>
                          <span className="text-gray-500 ml-1">— {linked.doc_name}</span>
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs font-bold">{linked?.type_code ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-600 text-xs">{asset.location ?? "—"}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => { setQrAsset(asset); setQrDocCode(asset.doc_code ?? ""); }}
                        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                      >
                        QR
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* QR dialog */}
      {qrAsset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setQrAsset(null)}>
          <div
            className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--pss-navy)" }}>
              QR Code
            </h3>
            <p className="text-sm text-gray-500 mb-4 font-mono">{qrAsset.asset_code} — {qrAsset.asset_name}</p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
              <select
                value={qrDocCode}
                onChange={(e) => setQrDocCode(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm mb-4"
              >
                <option value="">Form only (no document type)</option>
                {applicableDocDefs.map((d) => (
                  <option key={d.doc_code} value={d.doc_code}>
                    {d.doc_code} — {d.doc_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-center mb-4">
              <canvas id="qr-canvas" ref={canvasRef} className="border rounded" />
            </div>

            <p className="text-xs text-gray-400 text-center mb-4 font-mono">
              {qrDocCode
                ? `${docDefs.find((d) => d.doc_code === qrDocCode)?.type_code ?? qrAsset.asset_code.split("-")[0]}|${qrAsset.asset_code}|${qrDocCode}`
                : qrAsset.asset_code}
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={() => setQrAsset(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Close
              </button>
              <button
                onClick={downloadQR}
                className="px-4 py-2 text-sm text-white rounded hover:opacity-90"
                style={{ backgroundColor: "var(--pss-navy)" }}
              >
                Download PNG
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
