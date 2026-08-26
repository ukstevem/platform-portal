"use client";

import { useEffect, useState } from "react";
import { AssemblyViewer } from "./AssemblyViewer";

/**
 * Walk UP from a part to the assembly that should have been bought whole.
 *
 * Steve's design, made while looking at a handrail base plate sitting in the cut list:
 * "a 'show parent assembly' button which in this case would show me the handrail standard,
 * i can then click 'reform', a choice for 'bought out?' then appears and we can refile and
 * close out."
 *
 * ONE LEVEL AT A TIME, with the option to keep going up until the right assembly is reached.
 * That is not a detail: on job 10353 the level directly above the plate holds the whole
 * handrail standard (2 balls + 1 tube + 1 plate), but a level higher is the entire stair
 * area at 50 prototypes. Which one is "the assembly" is a judgement only the person looking
 * can make, so the UI's job is to let them look and step, not to guess.
 */

type Member = {
  prototype_key: string;
  class: string | null;
  designation: string | null;
  name: string | null;
  instances: number;
};

type Level = {
  level: number;
  instance_prefix: string;
  node: string;
  members: Member[];
  distinct_prototypes: number;
  leaves: number;
  already_bought: number;
};

export function AssemblyWalker({ modelId, fingerprintKey, onClose, onChanged }: {
  modelId: string; fingerprintKey: string;
  onClose: () => void; onChanged: () => void;
}) {
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [at, setAt] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/cad-review/api/cad/models/${modelId}/prototype/${fingerprintKey}/parent/`,
          { cache: "no-store" });
        if (!res.ok) { setErr(`parent returned ${res.status}`); return; }
        const d = await res.json();
        if (!d.levels?.length) { setErr("This part has no parent assembly in the model."); return; }
        setLevels(d.levels);
      } catch { setErr("Could not reach the CAD service"); }
    })();
  }, [modelId, fingerprintKey]);

  const lv = levels?.[at] ?? null;

  async function reform() {
    if (!lv) return;
    setBusy("Reforming and re-running the pipeline…");
    try {
      // The assembly key is content-addressed, so confirming it here is recalled on every
      // later job with the same arrangement - the point of doing this once.
      const key = await assemblyKeyFor(modelId, lv.instance_prefix);
      if (!key) { setErr("Could not identify this assembly."); setBusy(null); return; }
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/scope/unit/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assembly_key: key, designation: lv.members[0]?.name ?? null }),
      });
      if (!res.ok) { setErr(`scope/unit returned ${res.status}`); setBusy(null); return; }
      const { job_id } = await res.json();
      if (job_id) await waitFor(job_id, setBusy);
      onChanged(); onClose();
    } catch {
      setErr("Could not reach the CAD service");
    } finally { setBusy(null); }
  }

  if (err) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm text-amber-800">{err}</p>
      </Shell>
    );
  }
  if (!levels || !lv) {
    return <Shell onClose={onClose}><p className="text-sm text-slate-500">Looking up…</p></Shell>;
  }

  return (
    <Shell onClose={onClose}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">
          {at === 0 ? "Parent assembly" : `${at} level${at > 1 ? "s" : ""} up`}
        </span>
        <span className="font-mono text-xs text-slate-400">{lv.node}</span>
        <span className="text-xs text-slate-500">
          {lv.distinct_prototypes} distinct · {lv.leaves} leaves
          {lv.already_bought > 0 && (
            <span className="ml-1 text-emerald-700">· {lv.already_bought} already bought</span>
          )}
        </span>
      </div>

      <AssemblyViewer modelId={modelId} prefix={lv.instance_prefix}
                      className="my-2 h-64" />

      <div className="max-h-32 overflow-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <tbody>
            {lv.members.map((m) => (
              <tr key={m.prototype_key} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-1 text-slate-400">{m.class ?? "—"}</td>
                <td className="px-2 py-1">{m.designation ?? ""}</td>
                <td className="max-w-0 truncate px-2 py-1 text-slate-600">{m.name ?? ""}</td>
                <td className="px-2 py-1 text-right tabular-nums">×{m.instances}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          disabled={at + 1 >= levels.length || !!busy}
          onClick={() => { setAt(at + 1); setConfirming(false); }}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40">
          ↑ Up a level
        </button>
        <button
          disabled={at === 0 || !!busy}
          onClick={() => { setAt(at - 1); setConfirming(false); }}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40">
          ↓ Back down
        </button>

        {!confirming ? (
          <button disabled={!!busy} onClick={() => setConfirming(true)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            Reform
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Bought out?</span>
            <button disabled={!!busy} onClick={reform}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40">
              Yes — one bought line
            </button>
            <button disabled={!!busy} onClick={() => setConfirming(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
              Cancel
            </button>
          </span>
        )}
      </div>

      {busy && <p className="mt-2 text-xs text-slate-500">{busy}</p>}
      {confirming && !busy && (
        <p className="mt-2 text-xs text-slate-400 leading-snug">
          Its parts stop being fabricated and it becomes one purchased line. Learned by
          shape, so the same assembly is recognised on future jobs. Reversible.
        </p>
      )}
    </Shell>
  );
}

/** The assembly key is stored on the instances; ask for one of them. */
async function assemblyKeyFor(modelId: string, prefix: string): Promise<string | null> {
  const res = await fetch(
    `/cad-review/api/cad/models/${modelId}/subtree/?prefix=${encodeURIComponent(prefix)}`,
    { cache: "no-store" });
  if (!res.ok) return null;
  const d = await res.json();
  return d.assembly_key ?? null;
}

async function waitFor(jobId: string, note: (s: string) => void, tries = 120) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const res = await fetch(`/cad-review/api/cad/jobs/${jobId}/`, { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      if (j.status === "done" || j.status === "completed") {
        // The rescope chains a produce; the numbers are not right until that lands too.
        if (j.result?.produce_job_id) {
          note("Re-producing cut files…");
          return waitFor(j.result.produce_job_id, note, tries);
        }
        return;
      }
      if (j.status === "failed" || j.status === "error") return;
      if (j.phase) note(`${j.phase}…`);
    } catch { return; }
  }
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Reform assembly
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">×</button>
      </div>
      {children}
    </div>
  );
}
