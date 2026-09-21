"use client";

import { useState } from "react";

/**
 * Offered when a picture answers "not ready" (bd jj0p).
 *
 * The CAD service will not read a model's STEP file just to draw a picture: on job 10335 (722 MB)
 * that took four minutes and held the whole service while it did. Pictures are prepared once
 * instead - at ingest, or here for a model ingested before that - and kept on disk after.
 *
 * Reading the file still holds the service, so this is a button a person chooses to press,
 * with that said next to it, and never something a page does on its own.
 */
export function PreparePicturesBar({ modelId, onDone }: {
  modelId: string; onDone: () => void;
}) {
  const [preparing, setPreparing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function prepare() {
    setPreparing("starting…"); setErr(null);
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/prepare-pictures/`,
                              { method: "POST" });
      if (!res.ok) { setErr(`Preparing pictures returned ${res.status}`); return; }
      const { job_id } = await res.json();
      setPreparing("reading the model file…");
      if (await waitForJob(job_id, setPreparing)) onDone();
      else setErr("Preparing pictures did not finish - try again, or ask for help");
    } catch { setErr("Could not reach the CAD service"); }
    finally { setPreparing(null); }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200
                    bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {preparing ? (
        <>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-600" />
          <span>Preparing pictures — {preparing}</span>
        </>
      ) : (
        <>
          <span>{err ?? "Some pictures have not been prepared for this model."}</span>
          <button onClick={prepare} className="rounded bg-amber-900 px-3 py-1 text-sm text-white">
            Prepare pictures
          </button>
          <span className="text-xs text-amber-800">
            A few minutes on a large model, and the page is slow to respond while the model file
            is read. Once done, they are kept.
          </span>
        </>
      )}
    </div>
  );
}

/** Poll a job until it ends. While the service reads a large file it answers nothing, so a
 *  failed or timed-out poll means "still busy", not "gone". */
async function waitForJob(jobId: string, note: (s: string) => void): Promise<boolean> {
  for (let i = 0; i < 1440; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const res = await fetch(`/cad-review/api/cad/jobs/${jobId}/`, { cache: "no-store" });
      if (!res.ok) continue;
      const j = await res.json();
      if (j.status === "done") return true;
      if (j.status === "failed" || j.status === "cancelled") return false;
      if (j.phase && j.total) note(`${j.phase}, ${j.done} of ${j.total}`);
    } catch { /* busy reading the file - keep waiting */ }
  }
  return false;
}
