"use client";

import { useEffect, useState } from "react";
import { supabase } from "@platform/supabase/client";
import { StatusBadge } from "./StatusBadge";

const DOC_SERVICE_URL = process.env.NEXT_PUBLIC_DOC_SERVICE_URL ?? "";

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
  thumbnail_path: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

export function RecentJobs() {
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    const { data } = await supabase
      .from("document_incoming_scan")
      .select("id, file_name, status, type_code, asset_code, doc_code, period, document_type, filed_path, thumbnail_path, error_code, error_message, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    setJobs(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="text-gray-400 text-sm">Loading recent scans...</p>;
  if (!jobs.length) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
        Recent Scans
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4 font-medium w-16"></th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Asset</th>
              <th className="py-2 pr-4 font-medium">Document</th>
              <th className="py-2 pr-4 font-medium">Period</th>
              <th className="py-2 pr-4 font-medium">Filed As</th>
              <th className="py-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-1 pr-4">
                  {job.thumbnail_path ? (
                    <a
                      href={job.filed_path ? `${DOC_SERVICE_URL}/files/scanner/${job.filed_path}` : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${DOC_SERVICE_URL}/files/scanner/${job.thumbnail_path}`}
                        alt={job.file_name}
                        className="w-12 h-16 object-cover rounded border border-gray-200"
                      />
                    </a>
                  ) : (
                    <div className="w-12 h-16 bg-gray-100 rounded border border-gray-200 flex items-center justify-center text-gray-400 text-xs">
                      {job.status === "error" ? "!" : "..."}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <StatusBadge status={job.status} errorCode={job.error_code} error={job.error_message} />
                </td>
                <td className="py-2 pr-4 font-mono text-xs font-bold">{job.asset_code ?? "—"}</td>
                <td className="py-2 pr-4">
                  <span className="font-mono text-xs font-bold">{job.type_code ?? "—"}</span>
                  {job.doc_code && <span className="text-gray-500 ml-1">/ {job.doc_code}</span>}
                </td>
                <td className="py-2 pr-4 text-gray-600 text-xs">{job.period ?? "—"}</td>
                <td className="py-2 pr-4 font-mono text-xs truncate max-w-48" title={job.filed_path ?? undefined}>
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
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
