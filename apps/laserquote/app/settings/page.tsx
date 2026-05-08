"use client";

import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";

type Rate = {
  id: number;
  key: string;
  value: number;
  unit: string | null;
  label: string;
};

type Material = {
  id: number;
  material_class: string;
  grade: string;
  rate: number;
  density: number | null;
  active: boolean;
};

const CLASS_LABELS: Record<string, string> = {
  MILD: "Mild Steel",
  STAINLESS: "Stainless Steel",
  AL: "Aluminium",
};

// Seed classes shown in the dropdown when no rows exist yet. The DB CHECK
// constraint that used to lock these three was dropped in migration 039 —
// users can now add new classes (BRASS, COPPER, TITANIUM…) freely.
const SEED_CLASSES = ["MILD", "STAINLESS", "AL"] as const;
const NEW_CLASS_SENTINEL = "__new__";

type NewMatForm = {
  material_class: string;
  grade: string;
  rate: string;
  density: string;
};

const EMPTY_NEW_MAT: NewMatForm = {
  material_class: "MILD",
  grade: "",
  rate: "",
  density: "",
};

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const [rates, setRates] = useState<Rate[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [matEditing, setMatEditing] = useState<
    Record<number, { rate: string; density: string }>
  >({});
  const [matSaving, setMatSaving] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newMat, setNewMat] = useState<NewMatForm>(EMPTY_NEW_MAT);
  const [newClassMode, setNewClassMode] = useState(false);
  const [newClass, setNewClass] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const fetchAll = async () => {
    const [rateRes, matRes] = await Promise.all([
      supabase.from("laser_rate").select("*").order("id"),
      supabase
        .from("laser_material")
        .select("*")
        .order("material_class")
        .order("grade"),
    ]);
    setRates((rateRes.data as Rate[] | null) ?? []);
    setMaterials((matRes.data as Material[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user]);

  const handleSave = async (rate: Rate) => {
    const newValue = parseFloat(editing[rate.key] ?? String(rate.value));
    if (isNaN(newValue)) return;
    setSaving(rate.key);
    await supabase
      .from("laser_rate")
      .update({ value: newValue, updated_at: new Date().toISOString() })
      .eq("key", rate.key);
    setEditing((prev) => {
      const next = { ...prev };
      delete next[rate.key];
      return next;
    });
    setSaving(null);
    fetchAll();
  };

  const handleMatSave = async (mat: Material) => {
    const edit = matEditing[mat.id];
    if (!edit) return;
    const rateNum = parseFloat(edit.rate);
    if (isNaN(rateNum) || rateNum <= 0) return;
    const densityTrim = edit.density.trim();
    const densityNum = densityTrim === "" ? null : parseFloat(densityTrim);
    if (densityNum != null && (isNaN(densityNum) || densityNum <= 0)) return;
    setMatSaving(mat.id);
    await supabase
      .from("laser_material")
      .update({
        rate: rateNum,
        density: densityNum,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mat.id);
    setMatEditing((prev) => {
      const next = { ...prev };
      delete next[mat.id];
      return next;
    });
    setMatSaving(null);
    fetchAll();
  };

  const toggleActive = async (mat: Material) => {
    await supabase
      .from("laser_material")
      .update({
        active: !mat.active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mat.id);
    fetchAll();
  };

  const resolvedClass = newClassMode
    ? newClass.trim().toUpperCase()
    : newMat.material_class;

  const handleAdd = async () => {
    setAddError(null);
    const cls = resolvedClass;
    const grade = newMat.grade.trim().toUpperCase();
    const rateNum = parseFloat(newMat.rate);
    const densityTrim = newMat.density.trim();
    const densityNum = densityTrim === "" ? null : parseFloat(densityTrim);
    if (!cls) {
      setAddError("Class is required");
      return;
    }
    if (!grade) {
      setAddError("Grade is required");
      return;
    }
    if (isNaN(rateNum) || rateNum <= 0) {
      setAddError("Rate must be a positive number");
      return;
    }
    if (densityNum != null && (isNaN(densityNum) || densityNum <= 0)) {
      setAddError("Density must be a positive number (or blank for class default)");
      return;
    }
    if (materials.some((m) => m.grade.trim().toUpperCase() === grade)) {
      setAddError(`Grade '${grade}' already exists`);
      return;
    }
    setAddSaving(true);
    const { error } = await supabase.from("laser_material").insert({
      material_class: cls,
      grade,
      rate: rateNum,
      density: densityNum,
    });
    setAddSaving(false);
    if (error) {
      setAddError(error.message);
      return;
    }
    setAdding(false);
    setNewMat(EMPTY_NEW_MAT);
    setNewClassMode(false);
    setNewClass("");
    fetchAll();
  };

  // Distinct classes from existing rows + seeded set, for the add-row dropdown.
  const knownClasses = Array.from(
    new Set<string>([...SEED_CLASSES, ...materials.map((m) => m.material_class)])
  ).sort();

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>Settings</h1>
        <AuthButton redirectTo="/laserquote/settings" />
      </div>
    );
  }

  // Group rates by category. Material Rates section is rendered separately
  // from laser_material rather than via these hardcoded keys.
  const groups: { heading: string; keys: string[] }[] = [
    { heading: "Machine", keys: ["burden_rate"] },
    {
      heading: "Material Densities (class defaults)",
      keys: ["density_mild", "density_stainless", "density_al"],
    },
    {
      heading: "Charges & Thresholds",
      keys: ["min_handling", "handling_additional_sheet", "min_threshold"],
    },
    {
      heading: "Margins",
      keys: ["margin_standard", "margin_premium", "margin_pss", "margin_free_issue"],
    },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Rates & Settings" />

      {loading ? (
        <p className="text-gray-400 text-sm">Loading rates...</p>
      ) : (
        <div className="space-y-8">
          {/* Machine */}
          {groups.slice(0, 2).map((group) => (
            <RateGroup
              key={group.heading}
              group={group}
              rates={rates}
              editing={editing}
              setEditing={setEditing}
              saving={saving}
              onSave={handleSave}
            />
          ))}

          {/* Material Rates — sourced from laser_material */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Material Rates
              </h3>
              <button
                onClick={() => {
                  setAdding(true);
                  setAddError(null);
                }}
                disabled={adding}
                className="text-xs px-3 py-1 rounded text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "var(--pss-navy)" }}
              >
                + Add material
              </button>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-2">Class</th>
                    <th className="text-left px-4 py-2">Grade</th>
                    <th className="text-right px-4 py-2">Rate (£/tonne)</th>
                    <th className="text-right px-4 py-2">Density (g/cm³)</th>
                    <th className="text-center px-4 py-2">Active</th>
                    <th className="text-right px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {adding && (
                    <tr className="bg-sky-50">
                      <td className="px-3 py-2 align-top">
                        <select
                          value={newClassMode ? NEW_CLASS_SENTINEL : newMat.material_class}
                          onChange={(e) => {
                            if (e.target.value === NEW_CLASS_SENTINEL) {
                              setNewClassMode(true);
                            } else {
                              setNewClassMode(false);
                              setNewMat((p) => ({ ...p, material_class: e.target.value }));
                            }
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
                        >
                          {knownClasses.map((c) => (
                            <option key={c} value={c}>
                              {CLASS_LABELS[c] ?? c}
                            </option>
                          ))}
                          <option value={NEW_CLASS_SENTINEL}>+ New class…</option>
                        </select>
                        {newClassMode && (
                          <input
                            type="text"
                            value={newClass}
                            onChange={(e) => setNewClass(e.target.value)}
                            placeholder="BRASS"
                            className="mt-1 border border-gray-300 rounded px-2 py-1 text-xs w-full uppercase"
                            autoFocus
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="text"
                          value={newMat.grade}
                          onChange={(e) =>
                            setNewMat((p) => ({ ...p, grade: e.target.value }))
                          }
                          placeholder="grade"
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-full uppercase"
                          autoFocus={!newClassMode}
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="number"
                          step="any"
                          value={newMat.rate}
                          onChange={(e) =>
                            setNewMat((p) => ({ ...p, rate: e.target.value }))
                          }
                          placeholder="£/t"
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="number"
                          step="any"
                          value={newMat.density}
                          onChange={(e) =>
                            setNewMat((p) => ({ ...p, density: e.target.value }))
                          }
                          placeholder="default"
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-center text-gray-400 align-top">—</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap align-top">
                        <button
                          onClick={handleAdd}
                          disabled={addSaving}
                          className="text-xs px-3 py-1 rounded text-white hover:opacity-90 disabled:opacity-50 mr-1"
                          style={{ backgroundColor: "var(--pss-navy)" }}
                        >
                          {addSaving ? "..." : "Save"}
                        </button>
                        <button
                          onClick={() => {
                            setAdding(false);
                            setAddError(null);
                            setNewMat(EMPTY_NEW_MAT);
                            setNewClassMode(false);
                            setNewClass("");
                          }}
                          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  )}
                  {materials.length === 0 && !adding && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                        No materials configured.
                      </td>
                    </tr>
                  )}
                  {materials.map((mat) => {
                    const isEditing = mat.id in matEditing;
                    const edit = matEditing[mat.id];
                    return (
                      <tr key={mat.id} className={mat.active ? "" : "opacity-50"}>
                        <td className="px-4 py-2">
                          {CLASS_LABELS[mat.material_class] ?? mat.material_class}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{mat.grade}</td>
                        <td className="px-4 py-2 text-right font-mono">
                          {isEditing ? (
                            <input
                              type="number"
                              step="any"
                              value={edit.rate}
                              onChange={(e) =>
                                setMatEditing((p) => ({
                                  ...p,
                                  [mat.id]: { ...p[mat.id], rate: e.target.value },
                                }))
                              }
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                              autoFocus
                            />
                          ) : (
                            `£${mat.rate}`
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {isEditing ? (
                            <input
                              type="number"
                              step="any"
                              value={edit.density}
                              onChange={(e) =>
                                setMatEditing((p) => ({
                                  ...p,
                                  [mat.id]: { ...p[mat.id], density: e.target.value },
                                }))
                              }
                              placeholder="(default)"
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                            />
                          ) : mat.density != null ? (
                            mat.density
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={mat.active}
                            onChange={() => toggleActive(mat)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleMatSave(mat)}
                                disabled={matSaving === mat.id}
                                className="text-xs px-3 py-1 rounded text-white hover:opacity-90 disabled:opacity-50 mr-1"
                                style={{ backgroundColor: "var(--pss-navy)" }}
                              >
                                {matSaving === mat.id ? "..." : "Save"}
                              </button>
                              <button
                                onClick={() =>
                                  setMatEditing((p) => {
                                    const n = { ...p };
                                    delete n[mat.id];
                                    return n;
                                  })
                                }
                                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() =>
                                setMatEditing((p) => ({
                                  ...p,
                                  [mat.id]: {
                                    rate: String(mat.rate),
                                    density: mat.density != null ? String(mat.density) : "",
                                  },
                                }))
                              }
                              className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {addError && (
                <p className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t border-red-200">
                  {addError}
                </p>
              )}
            </div>
          </div>

          {/* Charges & Margins */}
          {groups.slice(2).map((group) => (
            <RateGroup
              key={group.heading}
              group={group}
              rates={rates}
              editing={editing}
              setEditing={setEditing}
              saving={saving}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type RateGroupProps = {
  group: { heading: string; keys: string[] };
  rates: Rate[];
  editing: Record<string, string>;
  setEditing: Dispatch<SetStateAction<Record<string, string>>>;
  saving: string | null;
  onSave: (rate: Rate) => void;
};

function RateGroup({ group, rates, editing, setEditing, saving, onSave }: RateGroupProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        {group.heading}
      </h3>
      <div className="bg-white border border-gray-200 rounded-lg divide-y">
        {group.keys.map((key) => {
          const rate = rates.find((r) => r.key === key);
          if (!rate) return null;
          const isEditing = key in editing;
          return (
            <div key={key} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{rate.label}</p>
                {rate.unit && <p className="text-xs text-gray-400">{rate.unit}</p>}
              </div>
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <input
                      type="number"
                      step="any"
                      value={editing[key]}
                      onChange={(e) =>
                        setEditing((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-28 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-500"
                      autoFocus
                    />
                    <button
                      onClick={() => onSave(rate)}
                      disabled={saving === key}
                      className="text-xs px-3 py-1 rounded text-white hover:opacity-90"
                      style={{ backgroundColor: "var(--pss-navy)" }}
                    >
                      {saving === key ? "..." : "Save"}
                    </button>
                    <button
                      onClick={() =>
                        setEditing((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        })
                      }
                      className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-sm font-medium">
                      {rate.key.startsWith("margin_")
                        ? `${(rate.value * 100).toFixed(0)}%`
                        : rate.value}
                    </span>
                    <button
                      onClick={() =>
                        setEditing((prev) => ({
                          ...prev,
                          [key]: String(rate.value),
                        }))
                      }
                      className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
