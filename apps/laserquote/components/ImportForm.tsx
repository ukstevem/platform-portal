"use client";

import { useState } from "react";
import { DropZone } from "./DropZone";

type ImportFormProps = {
  onUploaded?: () => void;
};

export function ImportForm({ onUploaded }: ImportFormProps) {
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Material</label>
            <select
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">Select...</option>
              <option value="MILD">Mild Steel</option>
              <option value="STAINLESS">Stainless Steel</option>
              <option value="AL">Aluminium</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grade</label>
            <input
              type="text"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. S275, 304, 316"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Lead Time</label>
            <input
              type="text"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. 2-3 weeks"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {useRate ? "Material Rate (£/tonne)" : "Sheet Price (£)"}
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={useRate ? materialRate : sheetPrice}
                onChange={(e) =>
                  useRate
                    ? setMaterialRate(e.target.value)
                    : setSheetPrice(e.target.value)
                }
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder={useRate ? "£/tonne" : "Sheet cost"}
                min="0"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-6 pt-2">
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
        remCharge={remCharge}
        onUploaded={onUploaded}
      />
    </div>
  );
}
