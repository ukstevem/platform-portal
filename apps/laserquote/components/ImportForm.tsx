"use client";

import { useEffect, useState } from "react";
import { supabase } from "@platform/supabase/client";
import { DropZone } from "./DropZone";

type ImportFormProps = {
  onUploaded?: () => void;
};

const CLASS_LABELS: Record<string, string> = {
  MILD: "Mild Steel",
  STAINLESS: "Stainless Steel",
  AL: "Aluminium",
};

type MaterialRow = {
  material_class: string;
  grade: string;
};

export function ImportForm({ onUploaded }: ImportFormProps) {
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [customer, setCustomer] = useState("");
  const [material, setMaterial] = useState("");
  const [grade, setGrade] = useState("");
  const [sheetPrice, setSheetPrice] = useState("");
  const [materialRate, setMaterialRate] = useState("");
  const [useRate, setUseRate] = useState(false);
  const [incoterms, setIncoterms] = useState("EXW");
  const [leadTime, setLeadTime] = useState("");
  const [premium, setPremium] = useState(false);
  const [remCharge, setRemCharge] = useState(false);
  const [freeIssue, setFreeIssue] = useState(false);

  useEffect(() => {
    supabase
      .from("laser_material")
      .select("material_class, grade")
      .eq("active", true)
      .order("material_class")
      .order("grade")
      .then(({ data }) => {
        if (data) setMaterials(data);
      });
  }, []);

  const materialClasses = [...new Set(materials.map((m) => m.material_class))];
  const grades = materials.filter((m) => m.material_class === material);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold" style={{ color: "var(--pss-navy)" }}>
          Job Details
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
            <input
              type="text"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="Customer name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Incoterms</label>
            <select
              value={incoterms}
              onChange={(e) => setIncoterms(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="EXW">EXW – Ex Works</option>
              <option value="FCA">FCA – Free Carrier</option>
              <option value="CPT">CPT – Carriage Paid To</option>
              <option value="CIP">CIP – Carriage & Insurance Paid To</option>
              <option value="DAP">DAP – Delivered at Place</option>
              <option value="DPU">DPU – Delivered at Place Unloaded</option>
              <option value="DDP">DDP – Delivered Duty Paid</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Material</label>
            <select
              value={material}
              onChange={(e) => {
                setMaterial(e.target.value);
                setGrade("");
              }}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">Select...</option>
              {materialClasses.map((mc) => (
                <option key={mc} value={mc}>{CLASS_LABELS[mc] ?? mc}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grade</label>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              disabled={!material}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">{material ? "Select grade..." : "Select material first"}</option>
              {grades.map((g) => (
                <option key={g.grade} value={g.grade}>{g.grade}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lead Time</label>
            <input
              type="text"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. 2-3 weeks"
            />
          </div>
        </div>

        {/* Material Pricing */}
        {!freeIssue && (
          <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">Material Pricing</h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useRate}
                  onChange={(e) => {
                    setUseRate(e.target.checked);
                    if (e.target.checked) setSheetPrice("");
                    else setMaterialRate("");
                  }}
                  className="rounded"
                />
                Calculate from rate
              </label>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                {useRate ? "Material Rate (£/tonne)" : "Sheet Price (£)"}
              </label>
              <input
                type="number"
                value={useRate ? materialRate : sheetPrice}
                onChange={(e) =>
                  useRate
                    ? setMaterialRate(e.target.value)
                    : setSheetPrice(e.target.value)
                }
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                placeholder={useRate ? "£/tonne override" : "Sheet cost override"}
                min="0"
              />
              <p className="text-xs text-gray-400 mt-1">
                {useRate
                  ? "Override the stored rate for this job"
                  : "Enter the actual sheet cost for this job"}
              </p>
            </div>
          </div>
        )}

        {/* Options */}
        <div className="flex gap-6 pt-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={premium}
              onChange={(e) => setPremium(e.target.checked)}
              className="rounded"
            />
            Premium
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={freeIssue}
              onChange={(e) => {
                setFreeIssue(e.target.checked);
                if (e.target.checked) {
                  setSheetPrice("");
                  setMaterialRate("");
                  setUseRate(false);
                }
              }}
              className="rounded"
            />
            Free Issue
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={remCharge}
              onChange={(e) => setRemCharge(e.target.checked)}
              className="rounded"
            />
            Remnant charge
          </label>
        </div>
      </div>

      <DropZone
        customer={customer}
        material={material}
        grade={grade}
        sheetPrice={sheetPrice}
        materialRate={materialRate}
        incoterms={incoterms}
        leadTime={leadTime}
        premium={premium}
        freeIssue={freeIssue}
        remCharge={remCharge}
        onUploaded={onUploaded}
      />
    </div>
  );
}
