"use client";

const DOC_SERVICE_URL = process.env.NEXT_PUBLIC_DOC_SERVICE_URL ?? "";

import { useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";

type ScanJob = {
  id: string;
  file_name: string;
  status: string;
  type_code: string | null;
  asset_code: string | null;
  doc_code: string | null;
  period: string | null;
  document_type: string | null;
  filed_path: string | null;
  error_message: string | null;
  created_at: string;
};

export default function HistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("document_incoming_scan")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setJobs(data ?? []);
        setLoading(false);
      });
  }, [user]);

  if (authLoading) return <div className="p-6 text-gray-500">Loading...</div>;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-gray-600">Sign in to view scan history</p>
        <AuthButton redirectTo="/scanner/history" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="Scan History" />

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : jobs.length === 0 ? (
        <p className="text-gray-500">No scans yet. Upload a document to get started.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Document</th>
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Filed As</th>
                <th className="py-2 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4">
                    <StatusBadge status={job.status} error={job.error_message} />
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs font-bold">{job.asset_code ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className="font-mono text-xs font-bold">{job.type_code ?? "—"}</span>
                    {job.doc_code && <span className="text-gray-500 ml-1">/ {job.doc_code}</span>}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 text-xs">{job.period ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs truncate max-w-64" title={job.filed_path ?? undefined}>
                    {job.filed_path ? (
                      <a
                        href={`${DOC_SERVICE_URL}/files/scanner/${job.filed_path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {job.filed_path.split("/").pop()}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="py-2 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(job.created_at).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
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
