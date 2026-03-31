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
  active: boolean;
};

type FilingRule = { type_code: string; document_type: string };
type DocDef = { doc_code: string; doc_name: string; type_code: string; category: string | null; interval_days: number | null; meta_required: boolean };

const FORM_PREFIXES = [
  { value: "HS", label: "Health & Safety", category: "hs-form" },
  { value: "DR", label: "Drawing / Design", category: "dr-form" },
  { value: "CR", label: "Correspondence", category: "cr-form" },
  { value: "MS", label: "Method Statement", category: "ms-form" },
  { value: "RP", label: "Report", category: "rp-form" },
  { value: "SH", label: "Schedule", category: "sh-form" },
  { value: "SN", label: "Specification", category: "sn-form" },
  { value: "DB", label: "Database / Register", category: "db-form" },
];

export default function FormsPage() {
  const { user, loading: authLoading } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filingRules, setFilingRules] = useState<FilingRule[]>([]);
  const [docDefs, setDocDefs] = useState<DocDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  // New form state
  const [showForm, setShowForm] = useState(false);
  const [step, setStep] = useState<"definition" | "asset">("definition");

  // Step 1: Document definition
  const [useExistingDef, setUseExistingDef] = useState(true);
  const [selectedDocCode, setSelectedDocCode] = useState("");
  const [newDocCode, setNewDocCode] = useState("");
  const [newDocName, setNewDocName] = useState("");
  const [newDocTypeCode, setNewDocTypeCode] = useState("");
  const [newDocInterval, setNewDocInterval] = useState("");

  // Step 2: Form asset
  const [formPrefix, setFormPrefix] = useState("HS");
  const [formName, setFormName] = useState("");
  const [formLocation, setFormLocation] = useState("");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // QR
  const [qrAsset, setQrAsset] = useState<Asset | null>(null);
  const [qrDocCode, setQrDocCode] = useState("");

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from("asset_register")
      .select("id, asset_code, asset_name, category, location, active")
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
      .select("type_code, document_type")
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
        (a.location ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Get the active doc definition (existing or new)
  const activeDocCode = useExistingDef ? selectedDocCode : newDocCode.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const activeDocDef = docDefs.find((d) => d.doc_code === selectedDocCode);
  const activeTypeCode = useExistingDef ? (activeDocDef?.type_code ?? "") : newDocTypeCode;

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

  const generatedAssetCode = formPrefix && activeDocCode
    ? `${formPrefix}-${activeDocCode}-${getNextSeq(`${formPrefix}-${activeDocCode}`)}`
    : "";

  const generatedCategory = formPrefix
    ? `${formPrefix.toLowerCase()}-form`
    : "";

  const qrPreview = activeTypeCode && generatedAssetCode && activeDocCode
    ? `${activeTypeCode}|${generatedAssetCode}|${activeDocCode}`
    : "";

  const resetForm = () => {
    setStep("definition");
    setUseExistingDef(true);
    setSelectedDocCode("");
    setNewDocCode("");
    setNewDocName("");
    setNewDocTypeCode("");
    setNewDocInterval("");
    setFormPrefix("HS");
    setFormName("");
    setFormLocation("");
    setFormError(null);
  };

  const handleNext = () => {
    if (useExistingDef && !selectedDocCode) {
      setFormError("Select a document definition");
      return;
    }
    if (!useExistingDef && (!newDocCode || !newDocName || !newDocTypeCode)) {
      setFormError("Document code, name, and type code are required");
      return;
    }
    if (!useExistingDef && newDocCode.includes("_")) {
      setFormError("Underscores are not allowed in document codes");
      return;
    }
    setFormError(null);

    // Pre-fill form name from doc definition
    if (useExistingDef && activeDocDef && !formName) {
      setFormName(activeDocDef.doc_name);
    } else if (!useExistingDef && !formName) {
      setFormName(newDocName);
    }

    setStep("asset");
  };

  const handleSave = async () => {
    setFormError(null);
    if (!generatedAssetCode || !formName) {
      setFormError("All required fields must be completed");
      return;
    }

    setSaving(true);

    // Create new doc definition if needed
    if (!useExistingDef) {
      const { error } = await supabase.from("document_definition").insert({
        doc_code: newDocCode.toUpperCase(),
        doc_name: newDocName,
        type_code: newDocTypeCode,
        category: generatedCategory,
        interval_days: newDocInterval ? parseInt(newDocInterval, 10) : null,
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
      location: formLocation || null,
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

  // Find linked doc definition for display
  const getLinkedDocDef = (asset: Asset): DocDef | undefined => {
    const parts = asset.asset_code.split("-");
    if (parts.length >= 2) {
      return docDefs.find((d) => d.doc_code === parts[1]);
    }
    return undefined;
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

      {/* New form wizard */}
      {showForm && (
        <div className="border rounded-lg p-4 mb-4 bg-gray-50">
          {step === "definition" ? (
            <>
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
                Step 1: Document Definition
              </h3>

              <div className="flex gap-4 mb-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={useExistingDef}
                    onChange={() => setUseExistingDef(true)}
                  />
                  Use existing definition
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={!useExistingDef}
                    onChange={() => setUseExistingDef(false)}
                  />
                  Create new definition
                </label>
              </div>

              {useExistingDef ? (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Document Definition *</label>
                  <select
                    value={selectedDocCode}
                    onChange={(e) => setSelectedDocCode(e.target.value)}
                    className="w-full md:w-1/2 border rounded px-2 py-1.5 text-sm"
                  >
                    <option value="">Select definition...</option>
                    {docDefs.map((d) => (
                      <option key={d.doc_code} value={d.doc_code}>
                        {d.doc_code} — {d.doc_name} ({d.type_code})
                      </option>
                    ))}
                  </select>
                  {activeDocDef && (
                    <p className="text-xs text-gray-500 mt-2">
                      Type: <strong>{activeDocDef.type_code}</strong> |
                      Interval: <strong>{activeDocDef.interval_days ? `${activeDocDef.interval_days} days` : "One-off"}</strong> |
                      Meta required: <strong>{activeDocDef.meta_required ? "Yes" : "No"}</strong>
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Doc Code *</label>
                    <input
                      type="text"
                      value={newDocCode}
                      onChange={(e) => setNewDocCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                      placeholder="e.g. TBT"
                      className="w-full border rounded px-2 py-1.5 text-sm font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                    <input
                      type="text"
                      value={newDocName}
                      onChange={(e) => setNewDocName(e.target.value)}
                      placeholder="e.g. Toolbox Talk"
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">ISO Type Code *</label>
                    <select
                      value={newDocTypeCode}
                      onChange={(e) => setNewDocTypeCode(e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">Select...</option>
                      {filingRules.map((r) => (
                        <option key={r.type_code} value={r.type_code}>
                          {r.type_code} — {r.document_type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Interval (days)</label>
                    <input
                      type="number"
                      value={newDocInterval}
                      onChange={(e) => setNewDocInterval(e.target.value)}
                      placeholder="e.g. 7 (blank = one-off)"
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
              )}

              {formError && <p className="text-red-600 text-sm mt-2">{formError}</p>}
              <div className="mt-3">
                <button
                  onClick={handleNext}
                  className="px-4 py-1.5 text-sm text-white rounded hover:opacity-90"
                  style={{ backgroundColor: "var(--pss-navy)" }}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--pss-navy)" }}>
                Step 2: Form Asset
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                Definition: <strong>{activeDocCode}</strong>
                {activeTypeCode && <> | ISO type: <strong>{activeTypeCode}</strong></>}
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Form Purpose *</label>
                  <select
                    value={formPrefix}
                    onChange={(e) => setFormPrefix(e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  >
                    {FORM_PREFIXES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.value} — {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Generated Code</label>
                  <input
                    type="text"
                    value={generatedAssetCode}
                    readOnly
                    className="w-full border rounded px-2 py-1.5 text-sm bg-white font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Weekly Toolbox Talk"
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location / Site</label>
                  <input
                    type="text"
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    placeholder="e.g. Carrwood Road"
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  />
                </div>
              </div>

              {qrPreview && (
                <p className="text-xs text-gray-500 mt-2">
                  QR will encode: <span className="font-mono font-bold">{qrPreview}</span>
                </p>
              )}

              {formError && <p className="text-red-600 text-sm mt-2">{formError}</p>}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => { setStep("definition"); setFormError(null); }}
                  className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                >
                  Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !generatedAssetCode || !formName}
                  className="px-4 py-1.5 text-sm text-white rounded disabled:opacity-50 hover:opacity-90"
                  style={{ backgroundColor: "var(--pss-navy)" }}
                >
                  {saving ? "Saving..." : "Create Form"}
                </button>
              </div>
            </>
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
                <th className="py-2 pr-4 font-medium">Doc Definition</th>
                <th className="py-2 pr-4 font-medium">ISO Type</th>
                <th className="py-2 pr-4 font-medium">Category</th>
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
                    <td className="py-2 pr-4 text-gray-600 text-xs">{asset.category}</td>
                    <td className="py-2 pr-4 text-gray-600 text-xs">{asset.location ?? "—"}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => { setQrAsset(asset); setQrDocCode(linked?.doc_code ?? ""); }}
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
