"use client";

import { useEffect, useState } from "react";
import { supabase } from "@platform/supabase/client";
import { StatusBadge } from "./StatusBadge";

type ImportJob = {
  id: string;
  status: string;
  error_message: string | null;
  file_count: number;
  customer: string | null;
  material: string | null;
  grade: string | null;
  premium: boolean;
  created_at: string;
  programs: { id: number; program_name: string; sheet_count: number; thickness: number | null }[];
};

export function ImportList() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    const { data } = await supabase
      .from("laser_import")
      .select(`
        id, status, error_message, file_count, customer, material, grade, premium, created_at,
        programs:laser_program(id, program_name, sheet_count, thickness),
        quotes:laser_quote(status)
      `)
      .order("created_at", { ascending: false })
      .limit(50);
    // Show queued/processing imports, or complete imports with at least one draft quote
    const filtered = ((data as (ImportJob & { quotes: { status: string }[] })[] | null) ?? []).filter((j) => {
      if (j.status === "queued" || j.status === "processing") return true;
      if (j.status === "complete") {
        return j.quotes?.some((q) => q.status === "draft");
      }
      return false;
    });
    setJobs(filtered.slice(0, 10));
    setLoading(false);
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="text-gray-400 text-sm">Loading recent imports...</p>;
  if (!jobs.length) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
        Recent Imports
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Customer</th>
              <th className="py-2 pr-4 font-medium">Material</th>
              <th className="py-2 pr-4 font-medium">Grade</th>
              <th className="py-2 pr-4 font-medium">Files</th>
              <th className="py-2 pr-4 font-medium">Programs</th>
              <th className="py-2 font-medium">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                className={`border-b last:border-0 hover:bg-gray-50 ${job.status === "complete" ? "cursor-pointer" : ""}`}
                onClick={() => job.status === "complete" && (window.location.href = `/laserquote/imports/${job.id}`)}
              >
                <td className="py-2 pr-4">
                  <StatusBadge status={job.status} error={job.error_message} />
                </td>
                <td className="py-2 pr-4 font-medium">
                  {job.status === "complete" ? (
                    <a href={`/laserquote/imports/${job.id}`} className="text-blue-600 hover:underline">
                      {job.customer ?? "—"}
                    </a>
                  ) : (
                    job.customer ?? "—"
                  )}
                </td>
                <td className="py-2 pr-4 text-xs">{job.material ?? "—"}</td>
                <td className="py-2 pr-4 text-xs uppercase">{job.grade ?? "—"}</td>
                <td className="py-2 pr-4 text-center">{job.file_count}</td>
                <td className="py-2 pr-4 text-xs">
                  {job.programs?.length
                    ? job.programs.map((p) => p.program_name).join(", ")
                    : "—"}
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
