"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";
import { AssetTable } from "@/components/AssetTable";

export default function FormsPage() {
  const { user, loading: authLoading } = useAuth();
  const [formCategories, setFormCategories] = useState<{ value: string; label: string; prefix: string }[]>([]);
  const [formSubtypes, setFormSubtypes] = useState<Record<string, { value: string; label: string }[]>>({});

  // Derive form categories and subtypes from existing assets
  useEffect(() => {
    if (!user) return;
    supabase
      .from("asset_register")
      .select("asset_code, category")
      .like("category", "%-form")
      .order("category")
      .then(({ data }) => {
        const cats = new Map<string, Set<string>>();
        (data ?? []).forEach((a) => {
          if (!cats.has(a.category)) cats.set(a.category, new Set());
          // Extract subtype from asset_code: HS-CAR-001 → CAR
          const parts = a.asset_code.split("-");
          if (parts.length >= 2) cats.get(a.category)!.add(parts[1]);
        });

        const categories: { value: string; label: string; prefix: string }[] = [];
        const subtypes: Record<string, { value: string; label: string }[]> = {};

        // Also add known form categories that might not have assets yet
        const knownForms: Record<string, { label: string; prefix: string; subs: { value: string; label: string }[] }> = {
          "hse-form": {
            label: "HSE Form",
            prefix: "HS",
            subs: [
              { value: "SIT", label: "Site Inspection" },
              { value: "CAR", label: "Carrwood Road" },
              { value: "FEX", label: "Fire Extinguisher Check" },
              { value: "HAV", label: "HAVS" },
              { value: "CON", label: "Contractor" },
              { value: "AEI", label: "Adverse Event" },
            ],
          },
        };

        for (const [cat, info] of Object.entries(knownForms)) {
          categories.push({ value: cat, label: info.label, prefix: info.prefix });
          subtypes[cat] = info.subs;
        }

        // Add any discovered categories not in the known list
        for (const [cat, subs] of cats) {
          if (!knownForms[cat]) {
            const prefix = cat.split("-")[0].toUpperCase();
            categories.push({ value: cat, label: cat.replace("-form", " Forms").replace(/^\w/, (c) => c.toUpperCase()), prefix });
            subtypes[cat] = [...subs].map((s) => ({ value: s, label: s }));
          }
        }

        setFormCategories(categories);
        setFormSubtypes(subtypes);
      });
  }, [user]);

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
      {formCategories.length > 0 ? (
        <AssetTable
          title="Form"
          categories={formCategories}
          subtypes={formSubtypes}
          showColumns={["location"]}
          formLabels={{ name: "Description", subtype: "Form Type" }}
        />
      ) : (
        <p className="text-gray-400 text-sm">Loading form categories...</p>
      )}
    </div>
  );
}
