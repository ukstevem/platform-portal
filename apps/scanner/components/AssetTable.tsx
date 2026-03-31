"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@platform/supabase/client";

type Asset = {
  id: number;
  asset_code: string;
  asset_name: string;
  category: string;
  location: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  active: boolean;
};

type DocDef = {
  doc_code: string;
  doc_name: string;
  type_code: string;
  category: string | null;
};

type CategoryDef = { value: string; label: string; prefix: string };
type SubtypeDef = { value: string; label: string };

type Props = {
  title: string;
  categories: CategoryDef[];
  subtypes: Record<string, SubtypeDef[]>;
  showColumns?: ("location" | "manufacturer" | "model" | "serial_number")[];
  formLabels?: { name: string; subtype?: string };
};

export function AssetTable({
  title,
  categories,
  subtypes,
  showColumns = ["location", "manufacturer", "model", "serial_number"],
  formLabels,
}: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [docDefs, setDocDefs] = useState<DocDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  // New asset form
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState(categories.length === 1 ? categories[0].value : "");
  const [subtype, setSubtype] = useState("");
  const [assetName, setAssetName] = useState("");
  const [location, setLocation] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [assetModel, setAssetModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // QR download
  const [qrAsset, setQrAsset] = useState<Asset | null>(null);
  const [qrDocCode, setQrDocCode] = useState("");
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const categoryValues = categories.map((c) => c.value);

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from("asset_register")
      .select("*")
      .in("category", categoryValues)
      .order("asset_code");
    setAssets(data ?? []);
    setLoading(false);
  }, [categoryValues.join(",")]);

  useEffect(() => {
    fetchAssets();
    supabase
      .from("document_definition")
      .select("doc_code, doc_name, type_code, category")
      .eq("active", true)
      .order("doc_code")
      .then(({ data }) => setDocDefs(data ?? []));
  }, [fetchAssets]);

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

  const generateAssetCode = (): string => {
    if (!category || !subtype) return "";
    const cat = categories.find((c) => c.value === category);
    if (!cat) return "";
    const prefix = `${cat.prefix}-${subtype}`;
    const seq = getNextSeq(prefix);
    return `${prefix}-${seq}`;
  };

  const handleSave = async () => {
    setFormError(null);
    const code = generateAssetCode();
    if (!code || !assetName) {
      setFormError("All required fields must be completed");
      return;
    }
    if (code.includes("_") || assetName.includes("_")) {
      setFormError("Underscores are not allowed — reserved as field separators");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("asset_register").insert({
      asset_code: code,
      asset_name: assetName,
      category,
      location: location || null,
      manufacturer: manufacturer || null,
      model: assetModel || null,
      serial_number: serialNumber || null,
    });

    if (error) {
      setFormError(error.message);
      setSaving(false);
      return;
    }

    setCategory(categories.length === 1 ? categories[0].value : "");
    setSubtype("");
    setAssetName("");
    setLocation("");
    setManufacturer("");
    setAssetModel("");
    setSerialNumber("");
    setShowForm(false);
    setSaving(false);
    fetchAssets();
  };

  // QR code rendering
  useEffect(() => {
    if (!qrAsset || !qrCanvasRef.current) return;

    const canvas = qrCanvasRef.current;
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
      const typeCode = docDef?.type_code ?? "HS";
      const content = qrDocCode
        ? `${typeCode}|${qrAsset.asset_code}|${qrDocCode}`
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
        const docName = docDef?.doc_name ?? "";
        ctx.fillText(docName, canvas.width / 2, size + padding + 34);
      }
    };
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [qrAsset, qrDocCode, docDefs]);

  const downloadQR = () => {
    if (!qrCanvasRef.current || !qrAsset) return;
    const link = document.createElement("a");
    const suffix = qrDocCode ? `_${qrDocCode}` : "";
    link.download = `${qrAsset.asset_code}${suffix}.png`;
    link.href = qrCanvasRef.current.toDataURL("image/png");
    link.click();
  };

  const applicableDocDefs = qrAsset
    ? docDefs.filter((d) => !d.category || d.category === qrAsset.category)
    : [];

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-48"
        />
        {categories.length > 1 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-1.5 text-sm text-white rounded hover:opacity-90"
          style={{ backgroundColor: "var(--pss-navy)" }}
        >
          {showForm ? "Cancel" : `+ New ${title}`}
        </button>
        <span className="text-xs text-gray-400 self-center ml-auto">
          {filtered.length} of {assets.length}
        </span>
      </div>

      {/* New asset form */}
      {showForm && (
        <div className="border rounded-lg p-4 mb-4 bg-gray-50">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
            New {title}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {categories.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
                <select
                  value={category}
                  onChange={(e) => { setCategory(e.target.value); setSubtype(""); }}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">Select...</option>
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {formLabels?.subtype ?? "Subtype"} *
              </label>
              <select
                value={subtype}
                onChange={(e) => setSubtype(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm"
                disabled={!category}
              >
                <option value="">Select...</option>
                {(subtypes[category] ?? []).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Code</label>
              <input
                type="text"
                value={generateAssetCode()}
                readOnly
                className="w-full border rounded px-2 py-1.5 text-sm bg-white font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {formLabels?.name ?? "Name"} *
              </label>
              <input
                type="text"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                placeholder={formLabels?.name === "Description" ? "e.g. Weekly Safety Inspection" : "e.g. Fab Shop North"}
                className="w-full border rounded px-2 py-1.5 text-sm"
              />
            </div>
            {showColumns.includes("location") && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Bay 2"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
            )}
            {showColumns.includes("manufacturer") && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Manufacturer</label>
                <input
                  type="text"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
            )}
            {showColumns.includes("model") && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                <input
                  type="text"
                  value={assetModel}
                  onChange={(e) => setAssetModel(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
            )}
            {showColumns.includes("serial_number") && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Serial Number</label>
                <input
                  type="text"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
            )}
          </div>
          {formError && <p className="text-red-600 text-sm mt-2">{formError}</p>}
          <div className="mt-3">
            <button
              onClick={handleSave}
              disabled={saving || !category || !subtype || !assetName}
              className="px-4 py-1.5 text-sm text-white rounded disabled:opacity-50 hover:opacity-90"
              style={{ backgroundColor: "var(--pss-navy)" }}
            >
              {saving ? "Saving..." : `Add ${title}`}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Category</th>
                {showColumns.includes("location") && <th className="py-2 pr-4 font-medium">Location</th>}
                {showColumns.includes("manufacturer") && <th className="py-2 pr-4 font-medium">Manufacturer</th>}
                {showColumns.includes("model") && <th className="py-2 pr-4 font-medium">Model</th>}
                {showColumns.includes("serial_number") && <th className="py-2 pr-4 font-medium">Serial</th>}
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
                  {showColumns.includes("location") && (
                    <td className="py-2 pr-4 text-gray-600 text-xs">{asset.location ?? "—"}</td>
                  )}
                  {showColumns.includes("manufacturer") && (
                    <td className="py-2 pr-4 text-gray-600 text-xs">{asset.manufacturer ?? "—"}</td>
                  )}
                  {showColumns.includes("model") && (
                    <td className="py-2 pr-4 text-gray-600 text-xs">{asset.model ?? "—"}</td>
                  )}
                  {showColumns.includes("serial_number") && (
                    <td className="py-2 pr-4 text-gray-600 text-xs">{asset.serial_number ?? "—"}</td>
                  )}
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
                <option value="">Asset only (no document type)</option>
                {applicableDocDefs.map((d) => (
                  <option key={d.doc_code} value={d.doc_code}>
                    {d.doc_code} — {d.doc_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-center mb-4">
              <canvas ref={qrCanvasRef} className="border rounded" />
            </div>

            <p className="text-xs text-gray-400 text-center mb-4 font-mono">
              {qrDocCode
                ? `${docDefs.find((d) => d.doc_code === qrDocCode)?.type_code ?? "HS"}|${qrAsset.asset_code}|${qrDocCode}`
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
