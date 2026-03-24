"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";

type FilingRule = {
  id: number;
  type_code: string;
  document_type: string;
  destination: string;
  description: string | null;
  retention_years: number | null;
  disposal_action: string | null;
  active: boolean;
};

export default function RulesPage() {
  const { user, loading: authLoading } = useAuth();
  const [rules, setRules] = useState<FilingRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("document_filing_rule")
      .select("*")
      .order("type_code")
      .then(({ data }) => {
        setRules(data ?? []);
        setLoading(false);
      });
  }, [user]);

  if (authLoading) return <div className="p-6 text-gray-500">Loading...</div>;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-gray-600">Sign in to view filing rules</p>
        <AuthButton redirectTo="/scanner/rules" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="Filing Rules — ISO 19650">
        <p className="text-sm text-gray-500">
          Document type codes per ISO 19650. PSS extensions prefixed with X-.
        </p>
      </PageHeader>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Type Code</th>
                <th className="py-2 pr-4 font-medium">Document Type</th>
                <th className="py-2 pr-4 font-medium">Destination</th>
                <th className="py-2 pr-4 font-medium">Description</th>
                <th className="py-2 pr-4 font-medium">Retention</th>
                <th className="py-2 pr-4 font-medium">Disposal</th>
                <th className="py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-mono text-xs font-bold">{rule.type_code}</td>
                  <td className="py-2 pr-4">{rule.document_type}</td>
                  <td className="py-2 pr-4 text-gray-600 font-mono text-xs">{rule.destination}</td>
                  <td className="py-2 pr-4 text-gray-500">{rule.description ?? "—"}</td>
                  <td className="py-2 pr-4 text-gray-600">
                    {rule.retention_years != null ? `${rule.retention_years}y` : "Permanent"}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 capitalize">{rule.disposal_action ?? "—"}</td>
                  <td className="py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        rule.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {rule.active ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
