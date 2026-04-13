"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { NestingPage } from "@/components/NestingPage";
import { CuttingListView } from "@/components/CuttingListView";
import type { CuttingList } from "@/components/CuttingListView";

type ResultSummary = {
  sections_processed: number;
  total_stocks_used: number;
  total_waste_mm: number;
  total_items_placed: number;
  total_items_unassigned: number;
};

type SavedPayload = {
  job_label?: string;
  sections: {
    section: string;
    cuts: { length: string; qty: string }[];
    stock: { length: string; qty: string }[];
  }[];
  kerf?: string;
};

type NestingJob = {
  id: string;
  project_number: string | null;
  task_id: string;
  status: "running" | "completed" | "failed";
  request_payload: SavedPayload;
  result_summary: ResultSummary | null;
  created_at: string;
};

export default function HistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<NestingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [rerunPayload, setRerunPayload] = useState<SavedPayload | null>(null);
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);
  const [viewResult, setViewResult] = useState<CuttingList | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- load jobs ---- */
  const loadJobs = useCallback(async () => {
    const { data } = await supabase
      .from("nesting_jobs")
      .select(
        "id, project_number, task_id, status, request_payload, result_summary, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (data) setJobs(data as NestingJob[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadJobs();
  }, [user, loadJobs]);

  /* ---- poll running jobs to update their status ---- */
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running");
    if (!hasRunning) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(async () => {
      const runningJobs = jobs.filter((j) => j.status === "running");
      let changed = false;

      for (const job of runningJobs) {
        try {
          const res = await fetch(
            `/nesting/api/nesting/status/${job.task_id}`
          );
          if (!res.ok) continue;
          const data = await res.json();

          if (data.status === "completed") {
            const clRes = await fetch(
              `/nesting/api/nesting/cutting-list/${job.task_id}`
            );
            const totals = clRes.ok
              ? (await clRes.json()).totals ?? null
              : null;

            await supabase
              .from("nesting_jobs")
              .update({ status: "completed", result_summary: totals })
              .eq("task_id", job.task_id);
            changed = true;
          } else if (data.status === "failed") {
            await supabase
              .from("nesting_jobs")
              .update({ status: "failed" })
              .eq("task_id", job.task_id);
            changed = true;
          }
        } catch {
          /* ignore transient errors */
        }
      }

      if (changed) loadJobs();
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobs, loadJobs]);

  /* ---- view results for a completed job ---- */
  async function handleViewResults(taskId: string) {
    setViewingTaskId(taskId);
    setViewResult(null);
    setViewLoading(true);

    try {
      const res = await fetch(
        `/nesting/api/nesting/cutting-list/${taskId}`
      );
      if (res.ok) {
        setViewResult(await res.json());
      }
    } catch {
      /* ignore */
    }
    setViewLoading(false);
  }

  /* ---- auth guards ---- */
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--pss-navy)" }}
        >
          Nesting History
        </h1>
        <p className="text-gray-600">Sign in to view nesting history</p>
        <AuthButton redirectTo="/nesting/history/" />
      </div>
    );
  }

  /* ---- rerun view ---- */
  if (rerunPayload) {
    const payload = {
      job_label: rerunPayload.job_label,
      sections: rerunPayload.sections.map((s, si) => ({
        id: si + 1,
        section: s.section,
        cuts: s.cuts.map((c, ci) => ({
          id: si * 1000 + ci + 1,
          length: c.length,
          qty: c.qty,
        })),
        stock: s.stock.map((st, sti) => ({
          id: si * 1000 + 500 + sti + 1,
          length: st.length,
          qty: st.qty,
        })),
      })),
      kerf: rerunPayload.kerf,
    };

    return (
      <div className="p-6 max-w-5xl mx-auto">
        <button
          type="button"
          onClick={() => setRerunPayload(null)}
          className="mb-4 text-sm text-blue-600 hover:underline cursor-pointer"
        >
          &larr; Back to history
        </button>
        <NestingPage initialPayload={payload} />
      </div>
    );
  }

  /* ---- results viewer ---- */
  if (viewingTaskId) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <button
          type="button"
          onClick={() => {
            setViewingTaskId(null);
            setViewResult(null);
          }}
          className="mb-4 text-sm text-blue-600 hover:underline cursor-pointer"
        >
          &larr; Back to history
        </button>

        {viewLoading ? (
          <p className="text-sm text-gray-500">Loading results...</p>
        ) : viewResult ? (
          <CuttingListView result={viewResult as CuttingList} taskId={viewingTaskId} />
        ) : (
          <p className="text-sm text-gray-500">
            Results not available — the nesting service may have restarted
            since this job ran.
          </p>
        )}
      </div>
    );
  }

  /* ---- helpers ---- */
  function fmtDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function totalCuts(payload: SavedPayload) {
    return payload.sections.reduce(
      (sum, s) =>
        sum + s.cuts.reduce((cs, c) => cs + (parseInt(c.qty) || 0), 0),
      0
    );
  }

  function sectionList(payload: SavedPayload) {
    return payload.sections.map((s) => s.section).join(", ");
  }

  const statusBadge = (status: NestingJob["status"]) => {
    const styles: Record<string, string> = {
      running: "bg-blue-100 text-blue-700",
      completed: "bg-green-100 text-green-700",
      failed: "bg-red-100 text-red-700",
    };
    return (
      <span
        className={`text-xs px-2 py-0.5 rounded font-medium ${styles[status] ?? ""}`}
      >
        {status === "running" ? "Running..." : status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  /* ---- main list ---- */
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="Nesting History" />

      {loading ? (
        <p className="text-sm text-gray-500 py-4">Loading jobs...</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No nesting jobs found.</p>
      ) : (
        <div className="border rounded overflow-auto">
          <table className="border-collapse text-sm w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="border px-3 py-2 text-left">Date</th>
                <th className="border px-3 py-2 text-left">Project</th>
                <th className="border px-3 py-2 text-left">Sections</th>
                <th className="border px-3 py-2 text-center">Status</th>
                <th className="border px-3 py-2 text-right">Cuts</th>
                <th className="border px-3 py-2 text-right">Stocks</th>
                <th className="border px-3 py-2 text-right">Waste</th>
                <th className="border px-3 py-2 w-32" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="border px-3 py-1.5 text-xs whitespace-nowrap">
                    {fmtDate(job.created_at)}
                  </td>
                  <td className="border px-3 py-1.5 font-mono text-xs">
                    {job.project_number ?? "—"}
                  </td>
                  <td className="border px-3 py-1.5 text-xs text-gray-600">
                    {sectionList(job.request_payload)}
                  </td>
                  <td className="border px-3 py-1.5 text-center">
                    {statusBadge(job.status)}
                  </td>
                  <td className="border px-3 py-1.5 text-right text-xs">
                    {totalCuts(job.request_payload)}
                  </td>
                  <td className="border px-3 py-1.5 text-right text-xs">
                    {job.result_summary?.total_stocks_used ?? "—"}
                  </td>
                  <td className="border px-3 py-1.5 text-right text-xs">
                    {job.result_summary
                      ? `${(job.result_summary.total_waste_mm / 1000).toFixed(1)} m`
                      : "—"}
                  </td>
                  <td className="border px-3 py-1.5 text-center space-x-2">
                    {job.status === "completed" && (
                      <button
                        type="button"
                        onClick={() => handleViewResults(job.task_id)}
                        className="text-xs font-medium cursor-pointer hover:underline"
                        style={{ color: "var(--pss-navy)" }}
                      >
                        View
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRerunPayload(job.request_payload)}
                      className="text-xs font-medium cursor-pointer hover:underline"
                      style={{ color: "var(--pss-navy)" }}
                    >
                      Rerun
                    </button>
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

