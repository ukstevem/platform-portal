"use client";

import { useEffect, useState } from "react";
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

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fetchRates = async () => {
    const { data } = await supabase
      .from("laser_rate")
      .select("*")
      .order("id");
    setRates((data as Rate[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchRates();
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
    fetchRates();
  };

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

  // Group rates by category
  const groups: { heading: string; keys: string[] }[] = [
    {
      heading: "Machine",
      keys: ["burden_rate"],
    },
    {
      heading: "Material Densities",
      keys: ["density_mild", "density_stainless", "density_al"],
    },
    {
      heading: "Material Rates",
      keys: ["rate_mild", "rate_304", "rate_316", "rate_al"],
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
          {groups.map((group) => (
            <div key={group.heading}>
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
                        {rate.unit && (
                          <p className="text-xs text-gray-400">{rate.unit}</p>
                        )}
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
                              onClick={() => handleSave(rate)}
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
          ))}
        </div>
      )}
    </div>
  );
}
