"use client";

const DOC_SERVICE_URL = process.env.NEXT_PUBLIC_DOC_SERVICE_URL ?? "";

import { useEffect, useState, useMemo } from "react";
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
  thumbnail_path: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

export default function HistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState("");
  const [assetFilter, setAssetFilter] = useState("");
  const [docFilter, setDocFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("document_incoming_scan")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setJobs(data ?? []);
        setLoading(false);
      });
  }, [user]);

  // Extract unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const types = new Set<string>();
    const assets = new Set<string>();
    const docs = new Set<string>();
    const statuses = new Set<string>();
    jobs.forEach((j) => {
      if (j.type_code) types.add(j.type_code);
      if (j.asset_code) assets.add(j.asset_code);
      if (j.doc_code) docs.add(j.doc_code);
      statuses.add(j.status);
    });
    return {
      types: [...types].sort(),
      assets: [...assets].sort(),
      docs: [...docs].sort(),
      statuses: [...statuses].sort(),
    };
  }, [jobs]);

  // Apply filters
  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (typeFilter && j.type_code !== typeFilter) return false;
      if (assetFilter && j.asset_code !== assetFilter) return false;
      if (docFilter && j.doc_code !== docFilter) return false;
      if (statusFilter && j.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const searchable = [
          j.file_name, j.type_code, j.asset_code, j.doc_code,
          j.document_type, j.filed_path, j.period,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, typeFilter, assetFilter, docFilter, statusFilter, search]);

  const hasActiveFilters = typeFilter || assetFilter || docFilter || statusFilter || search;

  if (authLoading) return <div className="p-6 text-gray-500">Loading...</div>;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-gray-600">Sign in to view document library</p>
        <AuthButton redirectTo="/scanner/history" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Document Library" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-48"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All types</option>
          {filterOptions.types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={assetFilter}
          onChange={(e) => setAssetFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All assets</option>
          {filterOptions.assets.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={docFilter}
          onChange={(e) => setDocFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All documents</option>
          {filterOptions.docs.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {filterOptions.statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            onClick={() => { setTypeFilter(""); setAssetFilter(""); setDocFilter(""); setStatusFilter(""); setSearch(""); }}
            className="text-sm text-gray-500 hover:text-gray-700 px-2"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-gray-400 self-center ml-auto">
          {filtered.length} of {jobs.length} documents
        </span>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : jobs.length === 0 ? (
        <p className="text-gray-500">No documents yet. Upload a document to get started.</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">No documents match the current filters.</p>
      ) : (
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
                <th className="py-2 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-1 pr-4">
                    {job.thumbnail_path ? (
                      <a
                        href={job.filed_path ? `${DOC_SERVICE_URL}${job.filed_path}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${DOC_SERVICE_URL}${job.thumbnail_path}`}
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
                  <td className="py-2 pr-4 font-mono text-xs truncate max-w-64" title={job.filed_path ?? undefined}>
                    {job.filed_path ? (
                      <a
                        href={`${DOC_SERVICE_URL}${job.filed_path}`}
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
