"use client";

import { useEffect, useState } from "react";
import { supabase } from "@platform/supabase";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";

type ProjectSummary = {
  projectnumber: string;
  description: string;
  contractValue: number;
  itemCount: number;
  completed: boolean;
};

export default function ProjectListPage() {
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [filter, setFilter] = useState<"live" | "completed" | "all">("live");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("project_register_items")
        .select("projectnumber, item_seq, line_desc, value, completed")
        .order("projectnumber")
        .order("item_seq");
      if (cancelled || !data) return;

      const projMap = new Map<string, ProjectSummary>();
      for (const r of data) {
        const existing = projMap.get(r.projectnumber);
        if (!existing) {
          projMap.set(r.projectnumber, {
            projectnumber: r.projectnumber,
            description: r.line_desc,
            contractValue: Number(r.value) || 0,
            itemCount: 1,
            completed: !!r.completed,
          });
        } else {
          if (r.item_seq === 1) existing.description = r.line_desc;
          existing.contractValue += Number(r.value) || 0;
          existing.itemCount += 1;
          if (!r.completed) existing.completed = false;
        }
      }

      setProjects(
        Array.from(projMap.values()).sort((a, b) => (parseInt(b.projectnumber) || 0) - (parseInt(a.projectnumber) || 0))
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = projects.filter((p) => {
    if (filter === "live") return !p.completed;
    if (filter === "completed") return p.completed;
    return true;
  });

  const fmtC = (v: number) =>
    `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-gray-600">Sign in to view projects</p>
        <AuthButton redirectTo="/operations/projects" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Projects</h1>
        <div className="flex rounded border overflow-hidden">
          {(["live", "completed", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-sm cursor-pointer ${filter === f ? "bg-[#061b37] text-white" : "hover:bg-gray-100"}`}
            >
              {f === "live" ? "Live" : f === "completed" ? "Completed" : "All"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-4">Loading projects...</div>
      ) : (
        <div className="border rounded overflow-auto">
          <table className="border-collapse text-sm w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="border px-3 py-2 text-left">Project</th>
                <th className="border px-3 py-2 text-left">Description</th>
                <th className="border px-3 py-2 text-right">Contract Value</th>
                <th className="border px-3 py-2 text-center">Items</th>
                <th className="border px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.projectnumber} className="hover:bg-gray-50">
                  <td className="border px-3 py-1.5">
                    <a href={`/operations/projects/${p.projectnumber}`} className="font-mono text-xs font-medium text-blue-600 hover:underline">
                      {p.projectnumber}
                    </a>
                  </td>
                  <td className="border px-3 py-1.5 text-xs text-gray-600">{p.description}</td>
                  <td className="border px-3 py-1.5 text-right">{fmtC(p.contractValue)}</td>
                  <td className="border px-3 py-1.5 text-center text-xs">{p.itemCount}</td>
                  <td className="border px-3 py-1.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${p.completed ? "bg-gray-200 text-gray-600" : "bg-green-100 text-green-700"}`}>
                      {p.completed ? "Completed" : "Live"}
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
