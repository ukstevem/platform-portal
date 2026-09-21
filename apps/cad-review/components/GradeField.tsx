"use client";

import { useState } from "react";

/**
 * The project's material grade (bd 3ytz).
 *
 * Ingest defaults to S275 and stamps it into every NC1 header. Job 10364 is S355, and all 41
 * of its cut files were written S275 before anyone noticed — the value was only reachable by
 * hand, through a PUT nobody in the workshop was going to make.
 *
 * Worse, and worth remembering: setting it once STORED correctly and produce ignored it, so
 * even this field would not have helped until the read-back was fixed. Stored and never
 * consulted is the recurring fault in this codebase; a control that appears to work while
 * changing nothing is the most expensive version of it.
 *
 * Changing the grade re-produces, because the grade is written INTO the files — leaving the
 * old ones on disk would leave the wrong material on the shop floor.
 */

const COMMON = ["S275", "S355", "S460"];

export function GradeField({ modelId, current, onChanged }: {
  modelId: string; current?: string | null; onChanged?: () => void;
}) {
  const [grade, setGrade] = useState(current || "S275");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dirty = (current || "S275") !== grade;

  async function save() {
    setBusy(true); setErr(null); setNote("Saving…");
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/grade/`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade }),
      });
      if (!res.ok) { setErr(`Setting the grade returned ${res.status}`); return; }

      // Re-produce: the grade is stamped into every NC1 header, so the files on disk are wrong
      // until they are written again.
      setNote("Re-producing cut files…");
      const p = await fetch(`/cad-review/api/cad/models/${modelId}/produce/`, { method: "POST" });
      if (p.ok) {
        const { job_id } = await p.json();
        if (job_id) await waitFor(job_id, setNote);
      }
      setNote(`Saved. Cut files now say ${grade}.`);
      onChanged?.();
    } catch { setErr("Could not reach the CAD service"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="text-xs text-slate-600">Grade</label>
      <input
        list="pss-grades" value={grade} disabled={busy}
        onChange={(e) => setGrade(e.target.value.toUpperCase())}
        className="w-24 rounded border border-slate-300 px-2 py-1 font-mono text-sm disabled:opacity-40" />
      <datalist id="pss-grades">
        {COMMON.map((g) => <option key={g} value={g} />)}
      </datalist>
      {dirty && (
        <button onClick={save} disabled={busy}
                className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40">
          {busy ? "Working…" : "Save & re-produce"}
        </button>
      )}
      {/* Said out loud, because it is not obvious that a dropdown rewrites 41 files. */}
      {dirty && !busy && (
        <span className="text-xs text-amber-800">
          every cut file is re-written with this grade
        </span>
      )}
      {note && !err && <span className="text-xs text-slate-500">{note}</span>}
      {err && <span className="text-xs text-amber-800">{err}</span>}
    </div>
  );
}

async function waitFor(jobId: string, note: (s: string) => void, tries = 120) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const res = await fetch(`/cad-review/api/cad/jobs/${jobId}/`, { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      if (j.status === "done" || j.status === "completed") return;
      if (j.status === "failed" || j.status === "error") { note("Produce failed."); return; }
      if (j.phase) note(`${j.phase}…`);
    } catch { return; }
  }
}
