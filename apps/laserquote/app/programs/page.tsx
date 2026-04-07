"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";

type Part = { id: number; part_name: string; quantity: number };

type Program = {
  id: number;
  program_name: string;
  material_code: string | null;
  thickness: number | null;
  strategy: string | null;
  sheet_count: number;
  sheet_x: number | null;
  sheet_y: number | null;
  runtime_seconds: number | null;
  utilisation: number | null;
  parts: Part[];
};

type Job = {
  id: string;
  customer: string | null;
  material: string | null;
  grade: string | null;
  premium: boolean;
  file_count: number;
  created_at: string;
  programs: Program[];
};

const SERVICE_PREFIX = "/laserquote/api/service";

export default function JobsPage() {
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [expandedProgs, setExpandedProgs] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [thicknessFilter, setThicknessFilter] = useState("");
  const [requoting, setRequoting] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("laser_import")
        .select(`
          id, customer, material, grade, premium, file_count, created_at,
          programs:laser_program(
            id, program_name, material_code, thickness, strategy,
            sheet_count, sheet_x, sheet_y, runtime_seconds, utilisation,
            parts:laser_part(id, part_name, quantity)
          )
        `)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(200);
      setJobs((data as Job[] | null) ?? []);
      setLoading(false);
    })();
  }, [user]);

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
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>Library</h1>
        <AuthButton redirectTo="/laserquote/programs" />
      </div>
    );
  }

  const customers = [...new Set(jobs.map((j) => j.customer).filter(Boolean) as string[])].sort();
  const grades = [...new Set(jobs.map((j) => j.grade).filter(Boolean) as string[])].sort();
  const thicknesses = [...new Set(
    jobs.flatMap((j) => (j.programs ?? []).map((p) => p.thickness)).filter(Boolean) as number[]
  )].sort((a, b) => a - b);

  const filtered = jobs.filter((j) => {
    if (customerFilter && j.customer !== customerFilter) return false;
    if (gradeFilter && j.grade !== gradeFilter) return false;
    if (thicknessFilter && !j.programs?.some((p) => String(p.thickness) === thicknessFilter)) return false;
    if (search) {
      const s = search.toLowerCase();
      const customerMatch = j.customer?.toLowerCase().includes(s);
      const progMatch = j.programs?.some((p) => p.program_name.toLowerCase().includes(s));
      if (!customerMatch && !progMatch) return false;
    }
    return true;
  });

  const toggleJob = (id: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleProg = (id: number) => {
    setExpandedProgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNewQuote = async (importId: string) => {
    setRequoting(importId);
    try {
      const res = await fetch(`${SERVICE_PREFIX}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId }),
      });
      if (res.ok) {
        await res.json();
        window.location.href = `/laserquote/imports/${importId}`;
      } else {
        alert("Failed to create quote");
      }
    } catch {
      alert("Service unavailable");
    }
    setRequoting(null);
  };

  const formatTime = (secs: number | null) => {
    if (!secs) return "—";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const totalSheets = (progs: Program[]) => progs.reduce((sum, p) => sum + p.sheet_count, 0);
  const totalParts = (progs: Program[]) => progs.reduce((sum, p) => sum + (p.parts?.length ?? 0), 0);
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <PageHeader title="Library" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search program or customer..."
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 w-64"
        />
        {customers.length > 1 && (
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        {grades.length > 1 && (
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">All grades</option>
            {grades.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
        {thicknesses.length > 1 && (
          <select
            value={thicknessFilter}
            onChange={(e) => setThicknessFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">All thicknesses</option>
            {thicknesses.map((t) => (
              <option key={t} value={String(t)}>{t}mm</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading jobs...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{jobs.length === 0 ? "No jobs imported yet." : "No jobs match your filter."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Material</th>
                <th className="py-2 pr-4 font-medium">Grade</th>
                <th className="py-2 pr-4 font-medium">Thick.</th>
                <th className="py-2 pr-4 font-medium">Programs</th>
                <th className="py-2 pr-4 font-medium">Sheets</th>
                <th className="py-2 pr-4 font-medium">Parts</th>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <React.Fragment key={job.id}>
                  <tr
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleJob(job.id)}
                  >
                    <td className="py-2 pr-4 font-medium">{job.customer ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs">{job.material ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs uppercase">{job.grade ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs">{job.programs?.[0]?.thickness ? `${job.programs[0].thickness}mm` : "—"}</td>
                    <td className="py-2 pr-4 text-center">{job.programs?.length ?? 0}</td>
                    <td className="py-2 pr-4 text-center">{totalSheets(job.programs ?? [])}</td>
                    <td className="py-2 pr-4 text-center">{totalParts(job.programs ?? [])}</td>
                    <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">{fmtDate(job.created_at)}</td>
                    <td className="py-2 text-right space-x-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleNewQuote(job.id); }}
                        disabled={requoting === job.id}
                        className="text-xs px-3 py-1 rounded text-white hover:opacity-90 bg-indigo-600 disabled:opacity-50"
                      >
                        {requoting === job.id ? "..." : "New Quote"}
                      </button>
                      <a
                        href={`/laserquote/imports/${job.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 inline-block"
                      >
                        View
                      </a>
                    </td>
                  </tr>

                  {/* Expanded: programs list */}
                  {expandedJobs.has(job.id) && job.programs?.length > 0 && (
                    <tr>
                      <td colSpan={9} className="bg-gray-50 px-6 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-gray-400">
                              <th className="py-1 pr-3">Program</th>
                              <th className="py-1 pr-3">Material</th>
                              <th className="py-1 pr-3">Thick.</th>
                              <th className="py-1 pr-3">Strategy</th>
                              <th className="py-1 pr-3 text-center">Sheets</th>
                              <th className="py-1 pr-3">Sheet Size</th>
                              <th className="py-1 pr-3">Runtime</th>
                              <th className="py-1 pr-3">Util.</th>
                              <th className="py-1 text-center">Parts</th>
                            </tr>
                          </thead>
                          <tbody>
                            {job.programs.map((prog) => (
                              <React.Fragment key={prog.id}>
                                <tr
                                  className="border-t border-gray-200 hover:bg-gray-100 cursor-pointer"
                                  onClick={() => toggleProg(prog.id)}
                                >
                                  <td className="py-1 pr-3 font-mono font-bold">{prog.program_name}</td>
                                  <td className="py-1 pr-3">{prog.material_code ?? "—"}</td>
                                  <td className="py-1 pr-3">{prog.thickness ? `${prog.thickness}mm` : "—"}</td>
                                  <td className="py-1 pr-3">{prog.strategy ?? "—"}</td>
                                  <td className="py-1 pr-3 text-center">{prog.sheet_count}</td>
                                  <td className="py-1 pr-3">
                                    {prog.sheet_x && prog.sheet_y ? `${prog.sheet_x} x ${prog.sheet_y}` : "—"}
                                  </td>
                                  <td className="py-1 pr-3">{formatTime(prog.runtime_seconds)}</td>
                                  <td className="py-1 pr-3">{prog.utilisation != null ? `${prog.utilisation}%` : "—"}</td>
                                  <td className="py-1 text-center">{prog.parts?.length ?? 0}</td>
                                </tr>

                                {/* Expanded: parts list */}
                                {expandedProgs.has(prog.id) && prog.parts?.length > 0 && (
                                  <tr>
                                    <td colSpan={9} className="bg-white px-6 py-2">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-left text-gray-300">
                                            <th className="py-0.5 pr-2">Part Name</th>
                                            <th className="py-0.5 text-right">Qty</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {prog.parts.map((part) => (
                                            <tr key={part.id} className="border-t border-gray-100">
                                              <td className="py-0.5 pr-2 font-mono">{part.part_name}</td>
                                              <td className="py-0.5 text-right">{part.quantity}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
