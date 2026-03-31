"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";

const DOC_SERVICE_URL = process.env.NEXT_PUBLIC_DOC_SERVICE_URL ?? "";

type Asset = {
  id: number;
  asset_code: string;
  asset_name: string;
  category: string;
  location: string | null;
  active: boolean;
};

type FilingRule = { type_code: string; document_type: string };
type DocDef = { doc_code: string; doc_name: string; type_code: string; category: string | null };

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
  const [typeCode, setTypeCode] = useState("");
  const [subtypeCode, setSubtypeCode] = useState("");
  const [formName, setFormName] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // QR
  const [qrAsset, setQrAsset] = useState<Asset | null>(null);
  const [qrDocCode, setQrDocCode] = useState("");
  const qrCanvasRef = useState<HTMLCanvasElement | null>(null);

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from("asset_register")
      .select("id, asset_code, asset_name, category, location, active")
      .like("category", "%-form")
      .order("asset_code");
    setAssets(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchAssets();
    supabase
      .from("document_filing_rule")
      .select("type_code, document_type")
      .eq("active", true)
      .order("type_code")
      .then(({ data }) => setFilingRules(data ?? []));
    supabase
      .from("document_definition")
      .select("doc_code, doc_name, type_code, category")
      .eq("active", true)
      .order("doc_code")
      .then(({ data }) => setDocDefs(data ?? []));
  }, [user, fetchAssets]);

  // Derive unique categories from existing forms
  const formCategories = [...new Set(assets.map((a) => a.category))].sort();

  // Derive existing subtypes for the selected type code
  const existingSubtypes = [...new Set(
    assets
      .filter((a) => typeCode && a.asset_code.startsWith(typeCode + "-"))
      .map((a) => {
        const parts = a.asset_code.split("-");
        return parts.length >= 2 ? parts[1] : null;
      })
      .filter(Boolean) as string[]
  )].sort();

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

  const generatedCode = typeCode && subtypeCode
    ? `${typeCode}-${subtypeCode.toUpperCase()}-${getNextSeq(`${typeCode}-${subtypeCode.toUpperCase()}`)}`
    : "";

  const categoryName = typeCode
    ? `${typeCode.toLowerCase()}-form`
    : "";

  const handleSave = async () => {
    setFormError(null);
    if (!generatedCode || !formName) {
      setFormError("Type, subtype code, and description are required");
      return;
    }
    if (generatedCode.includes("_")) {
      setFormError("Underscores are not allowed — reserved as field separators");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("asset_register").insert({
      asset_code: generatedCode,
      asset_name: formName,
      category: categoryName,
      location: location || null,
    });

    if (error) {
      setFormError(error.message);
      setSaving(false);
      return;
    }

    setTypeCode("");
    setSubtypeCode("");
    setFormName("");
    setLocation("");
    setShowForm(false);
    setSaving(false);
    fetchAssets();
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
        const assetTypeCode = qrAsset.asset_code.split("-")[0];
        return d.type_code === assetTypeCode || !d.category || d.category === qrAsset.category;
      })
    : [];

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
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-1.5 text-sm text-white rounded hover:opacity-90"
          style={{ backgroundColor: "var(--pss-navy)" }}
        >
          {showForm ? "Cancel" : "+ New Form"}
        </button>
        <span className="text-xs text-gray-400 self-center ml-auto">
          {filtered.length} of {assets.length}
        </span>
      </div>

      {/* New form */}
      {showForm && (
        <div className="border rounded-lg p-4 mb-4 bg-gray-50">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
            New Form Template
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ISO Type Code *</label>
              <select
                value={typeCode}
                onChange={(e) => { setTypeCode(e.target.value); setSubtypeCode(""); }}
                className="w-full border rounded px-2 py-1.5 text-sm"
              >
                <option value="">Select type...</option>
                {filingRules.map((r) => (
                  <option key={r.type_code} value={r.type_code}>
                    {r.type_code} — {r.document_type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Subtype Code *
                {existingSubtypes.length > 0 && (
                  <span className="text-gray-400 font-normal ml-1">
                    (existing: {existingSubtypes.join(", ")})
                  </span>
                )}
              </label>
              <input
                type="text"
                value={subtypeCode}
                onChange={(e) => setSubtypeCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="e.g. CAR, SIT, AEI"
                maxLength={5}
                className="w-full border rounded px-2 py-1.5 text-sm font-mono uppercase"
                disabled={!typeCode}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Generated Code</label>
              <input
                type="text"
                value={generatedCode}
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
                placeholder="e.g. Weekly Safety Inspection"
                className="w-full border rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Location / Site</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Carrwood Road"
                className="w-full border rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <input
                type="text"
                value={categoryName}
                readOnly
                className="w-full border rounded px-2 py-1.5 text-sm bg-white text-gray-500"
              />
            </div>
          </div>
          {formError && <p className="text-red-600 text-sm mt-2">{formError}</p>}
          <div className="mt-3">
            <button
              onClick={handleSave}
              disabled={saving || !typeCode || !subtypeCode || !formName}
              className="px-4 py-1.5 text-sm text-white rounded disabled:opacity-50 hover:opacity-90"
              style={{ backgroundColor: "var(--pss-navy)" }}
            >
              {saving ? "Saving..." : "Add Form"}
            </button>
          </div>
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
                <th className="py-2 pr-4 font-medium">Category</th>
                <th className="py-2 pr-4 font-medium">Location</th>
                <th className="py-2 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => (
                <tr
                  key={asset.id}
                  className={`border-b last:border-0 hover:bg-gray-50 ${!asset.active ? "opacity-40" : ""}`}
                >
                  <td className="py-2 pr-4 font-mono text-xs font-bold">{asset.asset_code}</td>
                  <td className="py-2 pr-4">{asset.asset_name}</td>
                  <td className="py-2 pr-4 text-gray-600 text-xs">{asset.category}</td>
                  <td className="py-2 pr-4 text-gray-600 text-xs">{asset.location ?? "—"}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => { setQrAsset(asset); setQrDocCode(""); }}
                      className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      QR
                    </button>
                  </td>
                </tr>
              ))}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Document Type (optional)</label>
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
