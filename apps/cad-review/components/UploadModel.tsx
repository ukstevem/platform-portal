"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * The front door: put a STEP in and get a scoped, identified, produced model out.
 *
 * Until this existed the middle of the pipeline was built and BOTH ENDS needed an agent — every
 * job began with someone else running ingest for you. That is the gap Steve kept hitting:
 * "im not getting anywhere with usseable output", and later, the observation that every defect
 * found this week took a round trip through a conversation.
 *
 * Ingest CHAINS identify and produce (bd 920), so one action carries the model all the way to
 * "ready to review". The phases are reported as they happen rather than behind one spinner,
 * because a 200 MB STEP takes minutes and a dead-looking button is indistinguishable from a
 * broken one.
 */
export function UploadModel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState("");
  const [phase, setPhase] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A 409 from ingest: this exact file is already in this project. Held rather than thrown
  // away, because the answer is usually "open that one" and occasionally "yes, again".
  const [dup, setDup] = useState<Dup | null>(null);

  async function submit(e: React.FormEvent, allowDuplicate = false) {
    e.preventDefault();
    setDup(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Choose a STEP file."); return; }
    if (!project.trim()) { setErr("A project number is required — it is stamped into every NC1 header and every piece mark."); return; }

    setErr(null); setBusy(true); setPhase("Uploading…");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("project_number", project.trim());
      const res = await fetch(
        `/cad-review/api/cad/models/?identify=true&produce=true${
          allowDuplicate ? "&allow_duplicate=true" : ""}`,
        { method: "POST", body });
      if (!res.ok) {
        let detail: unknown = "";
        try { detail = (await res.json())?.detail ?? ""; } catch { /* not json */ }
        // The duplicate case is not an error to report and forget — it names the models it
        // found, and the useful next action is to open one.
        if (res.status === 409 && detail && typeof detail === "object"
            && (detail as Dup).reason === "duplicate_file") {
          setDup(detail as Dup);
          return;
        }
        const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
        setErr(`Ingest returned ${res.status}${msg ? ` — ${msg}` : ""}`);
        return;
      }
      const { job_id } = await res.json();
      const modelId = await waitForIngest(job_id, setPhase);
      if (!modelId) { setErr("Ingest finished without a model id."); return; }
      setPhase("Ready.");
      router.push(`/${modelId}/`);
    } catch {
      setErr("Could not reach the CAD service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}
          className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div>
        <h2 className="text-sm font-medium">Add a model</h2>
        <p className="text-xs text-slate-500">
          A STEP file. Ingest, identification and cut files run in one go — expect a few
          minutes for a large assembly.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">
          <span className="block mb-1">STEP file</span>
          <input ref={fileRef} type="file" accept=".step,.stp,.STEP,.STP"
                 disabled={busy}
                 className="block text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-900
                            file:px-3 file:py-1.5 file:text-sm file:text-white disabled:opacity-40" />
        </label>
        <label className="text-xs text-slate-600">
          <span className="block mb-1">Project number</span>
          <input value={project} onChange={(e) => setProject(e.target.value)}
                 placeholder="10353" disabled={busy}
                 className="w-32 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40" />
        </label>
        <button type="submit" disabled={busy}
                className="rounded bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-40">
          {busy ? phase || "Working…" : "Ingest"}
        </button>
      </div>

      {busy && (
        <p className="text-xs text-slate-500">
          {phase} — this page can be left open; the work runs on the server.
        </p>
      )}
      {dup && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-2">
          <p>{dup.message}</p>
          <ul className="space-y-1">
            {dup.models.map((m) => (
              <li key={m.model_id} className="flex flex-wrap items-center gap-2">
                <a href={`/cad-review/${m.model_id}/`}
                   className="rounded bg-white px-2 py-1 font-medium underline">
                  Open {m.model_id.slice(0, 8)}
                </a>
                <span className="tabular-nums text-amber-800">
                  ingested {fmt(m.ingested_at)}
                  {m.produced_at && ` · cut files ${fmt(m.produced_at)}`}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy}
                  onClick={(e) => submit(e, true)}
                  className="rounded border border-amber-400 bg-white px-3 py-1 font-medium disabled:opacity-40">
            Ingest anyway
          </button>
        </div>
      )}
      {err && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {err}
        </p>
      )}
      {/* The project number is not cosmetic, so say why before someone types "test". */}
      <p className="text-xs text-slate-400">
        The project number is stamped into every NC1 header and scopes the piece marks, so the
        same part keeps its mark across revisions of the same job.
      </p>
    </form>
  );
}

type Dup = {
  reason: string;
  message: string;
  sha256: string;
  models: { model_id: string; name: string; ingested_at: string | null;
            produced_at: string | null }[];
};

/** Date and TIME. Two ingests of one file 49 minutes apart are indistinguishable by date. */
function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB",
    { hour: "2-digit", minute: "2-digit" })}`;
}

/** Poll the ingest job, reporting phases, and return the model id. */
async function waitForIngest(jobId: string, phase: (s: string) => void,
                             tries = 240): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const res = await fetch(`/cad-review/api/cad/jobs/${jobId}/`, { cache: "no-store" });
      if (!res.ok) continue;
      const job = await res.json();
      if (job.phase) phase(`${job.phase}…`);
      if (job.status === "done" || job.status === "completed") {
        const modelId = job.result?.model_id ?? null;
        // Ingest chains a produce; the model is reviewable before it finishes, but the
        // parts and cut files are not there yet, so wait rather than land on a half-built page.
        if (job.result?.produce_job_id) {
          phase("Producing cut files…");
          await waitForIngest(job.result.produce_job_id, phase, tries);
        }
        return modelId;
      }
      if (job.status === "failed" || job.status === "error") {
        phase(job.error ? `Failed: ${job.error}` : "Failed.");
        return null;
      }
    } catch {
      return null;
    }
  }
  phase("Still running — reload the model list shortly.");
  return null;
}
