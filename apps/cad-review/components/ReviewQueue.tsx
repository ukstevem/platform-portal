"use client";

import { useCallback, useEffect, useState } from "react";
import { PartViewer } from "./PartViewer";

/**
 * The review queue.
 *
 * The queue is not one kind of thing — it is three, and the reviewer's ACTION differs by
 * kind. Conflating them into one flat list of things-to-fix is what made the first cut
 * confusing, and it counts the wrong noun as well: "135 items" on C24025 was ~13 distinct
 * prototypes. Counts here are PROTOTYPES, with physical quantity as secondary detail.
 */

type Item = {
  fingerprint_key: string;
  mark: string | null;
  name: string | null;
  class: string | null;
  designation: string | null;
  qty: number | null;
  cut_file: string | null;
  n_solids: number | null;
  human: boolean;
};

type Queue = {
  kinds: Record<Kind, Item[]>;
  counts: Record<Kind, number>;
  pieces: Record<Kind, number>;
  open_prototypes: number;
  held_flat_pattern: number;
  saw_cut_no_nc1: number;
  clear: boolean;
  produce_stale: boolean;
  actions: Record<Kind, string>;
};

type Kind = "needs_type" | "needs_size" | "cannot_cut" | "confirmed" | "excluded"
          | "held";

const KIND_LABEL: Record<Kind, string> = {
  needs_type: "Needs a type",
  needs_size: "Needs a size",
  cannot_cut: "No cut file",
  confirmed: "Confirmed",
  excluded: "Excluded",
  held: "Held — flat pattern",
};

const KIND_BLURB: Record<Kind, string> = {
  needs_type: "Unclassified or a multi-body group. Pick the type — make/buy follows by rule.",
  needs_size: "Correctly classified, but not in the catalogue. Set the size by hand.",
  cannot_cut: "Sized, but the resolver could not produce an NC1. Confirm to accept it.",
  confirmed: "Settled by a person. Re-open if it was a misclick.",
  excluded: "Not supplied. Visible on purpose — excluding must not be a one-way door.",
  held: "Needs an unfolded flat pattern before it can be cut — or the classifier read it "
      + "wrong. A skewed cut on a section reads as a formed plate; if that is what this is, "
      + "set the right type and size here.",
};

const TYPES = ["SECTION", "PLATE", "TUBE", "PIPE", "RAIL", "FORMED_PLATE",
               "BOUGHT_OUT", "PROPRIETARY", "ASSEMBLY_UNIT", "EXCLUDE"];

export function ReviewQueue({ modelId }: { modelId: string }) {
  const [q, setQ] = useState<Queue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Kind>("needs_type");
  const [sizes, setSizes] = useState<Record<string, string>>({});
  // Selecting a part loads ONE mesh. Rendering all sixteen at once would mean
  // sixteen meshes and, for this job, ~300 bodies before the reviewer looks at
  // anything.
  const [sel, setSel] = useState<string | null>(null);
  const [busyNote, setBusyNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // The trailing slash is deliberate: next.config sets trailingSlash, so without it
      // every call eats a 308 redirect first.
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/review/queue/`,
                              { cache: "no-store" });
      if (!res.ok) { setErr(`Queue returned ${res.status}`); return; }
      setQ(await res.json()); setErr(null);
    } catch {
      setErr("Could not reach the CAD service");
    }
  }, [modelId]);

  useEffect(() => { load(); }, [load]);

  /** Poll a background job to completion. Bounded, because a hung job must not leave the
   *  page spinning forever with no way to find out why. */
  async function waitForJob(jobId: string, tries = 90): Promise<void> {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/cad-review/api/cad/jobs/${jobId}/`, { cache: "no-store" });
        if (!res.ok) return;
        const st = (await res.json())?.status;
        if (st === "done" || st === "completed") return;
        if (st === "failed" || st === "error") {
          setErr("The parts were created, but producing their cut files failed.");
          return;
        }
      } catch {
        return;                       // service unreachable - load() will report it
      }
    }
    setErr("Producing the new parts is taking longer than expected - reload to check.");
  }

  async function act(path: string, body: Record<string, unknown> | null, key: string,
                     note?: string) {
    setBusy(key);
    if (note) setBusyNote(note);
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/${path}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === null ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        // Show what the service actually said. "explode returned 422" alone sends you to
        // the wrong place; the detail says whether it is not a multi-body part at all.
        let detail = "";
        try { detail = (await res.json())?.detail ?? ""; } catch { /* not json */ }
        setErr(`${path} returned ${res.status}${detail ? ` — ${detail}` : ""}`);
      } else {
        // Exploding replaces one row with its members and CHAINS A PRODUCE. Reloading
        // straight away shows the members between the two: identified but with no cut file
        // and, for a plate, no thickness yet - which reads as a queue full of review tasks
        // that are really just work in progress. Wait for the job this action started.
        let job: string | null = null;
        try { job = (await res.json())?.produce_job_id ?? null; } catch { /* no body */ }
        if (job) {
          setBusyNote("Producing the new parts…");
          await waitForJob(job);
        }
        setSel(null);
        await load();
      }
    } catch {
      setErr("Could not reach the CAD service");
    } finally {
      setBusy(null); setBusyNote(null);
    }
  }

  if (err) return <Banner tone="warn">{err}</Banner>;
  if (!q) return <p className="text-sm text-slate-500">Loading the queue…</p>;

  return (
    <div className="space-y-4">
      {q.produce_stale && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Re-producing — these counts are mid-flight. A re-identify clears sizes and only
          produce writes them back, so anything below may still be catching up.
        </div>
      )}
      <Summary q={q} />

      <div className="flex gap-2 flex-wrap">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => { setOpen(k); setSel(null); }}
            className={`rounded-full px-3 py-1.5 text-sm border transition ${
              open === k
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {KIND_LABEL[k]}
            <span className="ml-2 tabular-nums opacity-70">{q.counts[k]}</span>
          </button>
        ))}
      </div>

      <p className="text-sm text-slate-500">
        {KIND_BLURB[open]}{" "}
        <span className="text-slate-400">Click a row to see the part.</span>
      </p>

      {q.kinds[open].length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          Nothing here.
        </p>
      ) : (
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_24rem]">
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white self-start">
          {q.kinds[open].map((it) => (
            <li key={it.fingerprint_key}
                onClick={() => setSel(it.fingerprint_key)}
                className={`cursor-pointer border-l-4 px-4 py-3 transition ${
                  sel === it.fingerprint_key
                    ? "border-l-slate-900 bg-slate-100"
                    : "border-l-transparent hover:border-l-slate-300 hover:bg-slate-50"}`}>
              <div className="flex items-start gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{it.mark ?? "—"}</span>
                    {it.class && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {it.class}
                      </span>
                    )}
                    {it.designation && (
                      <span className="text-xs text-slate-500">{it.designation}</span>
                    )}
                    {(it.n_solids ?? 1) > 1 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        {it.n_solids} bodies
                      </span>
                    )}
                    {busy === it.fingerprint_key && busyNote && (
                      <span className="text-xs text-slate-500">{busyNote}</span>
                    )}
                  </div>
                  {/* The CAD name is what ties this row back to the model and the drawing. */}
                  <div className="truncate text-sm text-slate-700">{it.name ?? ""}</div>
                  <div className="text-xs text-slate-400">
                    ×{it.qty ?? 1}
                    {it.cut_file ? ` · ${it.cut_file}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap"
                     onClick={(e) => e.stopPropagation()}>
                  {(open === "needs_size" || open === "held") && (
                    <>
                      <input
                        value={sizes[it.fingerprint_key] ?? ""}
                        onChange={(e) =>
                          setSizes({ ...sizes, [it.fingerprint_key]: e.target.value })}
                        placeholder="e.g. UB127x76x13"
                        className="w-44 rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                      <button
                        disabled={!sizes[it.fingerprint_key] || busy === it.fingerprint_key}
                        onClick={() => act("review",
                          { fingerprint_key: it.fingerprint_key,
                            designation: sizes[it.fingerprint_key] }, it.fingerprint_key)}
                        className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                      >
                        Set size
                      </button>
                    </>
                  )}

                  {/* A multi-body part is not a classification problem — it is an
                      assembly the machine has not been told how to treat, so picking a type
                      for a 30-body weld group answers the wrong question (bd j05, rl2).
                      EXPLODE is the usual answer. "Bought in" is NOT a no-op just because
                      the part is already whole: it records that this is purchased
                      equipment, marks it bought so it stays on the BOM as a cost, stops
                      identify drilling into its internals, and is learned by fingerprint so
                      no later job asks again. That is what separates it from Exclude, which
                      takes the part out of supply altogether. */}
                  {(it.n_solids ?? 1) > 1 && open !== "confirmed" && open !== "excluded" && (
                    <>
                      <button
                        disabled={busy === it.fingerprint_key}
                        onClick={() => act(`explode/${it.fingerprint_key}`, null,
                          it.fingerprint_key, "Exploding and re-producing…")}
                        className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                      >
                        Explode
                      </button>
                      <button
                        disabled={busy === it.fingerprint_key}
                        onClick={() => act(`scope/part/${it.fingerprint_key}`,
                          { treatment: "keep_whole" }, it.fingerprint_key)}
                        className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Bought in
                      </button>
                    </>
                  )}

                  {(open === "needs_type" || open === "held") && (
                    <select
                      defaultValue=""
                      disabled={busy === it.fingerprint_key}
                      onChange={(e) => e.target.value && act("review",
                        { fingerprint_key: it.fingerprint_key, type: e.target.value },
                        it.fingerprint_key)}
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="" disabled>Set type…</option>
                      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}

                  {/* EXCLUDE is a first-class one-click action, not an option buried in a
                      type dropdown — on job 10353 the entire review queue was 16 weld
                      groups, all of them excludable. */}
                  {open !== "confirmed" && open !== "excluded" && (
                    <button
                      disabled={busy === it.fingerprint_key}
                      onClick={() => act("review",
                        { fingerprint_key: it.fingerprint_key, type: "EXCLUDE" },
                        it.fingerprint_key)}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Exclude
                    </button>
                  )}

                  {open === "cannot_cut" && (
                    <button
                      disabled={busy === it.fingerprint_key}
                      onClick={() => act("review",
                        { fingerprint_key: it.fingerprint_key,
                          designation: it.designation }, it.fingerprint_key)}
                      className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                    >
                      Accept
                    </button>
                  )}

                  {/* No dead-ends on a misclick. */}
                  {(open === "confirmed" || open === "excluded") && (
                    <button
                      disabled={busy === it.fingerprint_key}
                      onClick={() => act(
                        open === "excluded" ? "review" : "review/reopen",
                        open === "excluded"
                          ? { fingerprint_key: it.fingerprint_key, type: "MIXED" }
                          : { fingerprint_key: it.fingerprint_key },
                        it.fingerprint_key)}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {open === "excluded" ? "Bring back" : "Re-open"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* self-start is what makes sticky work: a stretched grid item fills its row and
            has nothing to slide within. */}
        <div className="order-first md:order-none md:self-start md:sticky md:top-4
                        h-[26rem] md:h-[calc(100vh-8rem)] md:max-h-[40rem]
                        md:overflow-y-auto">
          <PartViewer modelId={modelId} fingerprintKey={sel} />
        </div>
      </div>
      )}
    </div>
  );
}

function Summary({ q }: { q: Queue }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-2xl font-semibold tabular-nums">{q.open_prototypes}</span>
        <span className="text-sm text-slate-600">
          {q.open_prototypes === 1 ? "prototype" : "prototypes"} to review
        </span>
        {q.clear && (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
            queue clear
          </span>
        )}
      </div>
      {/* Every automated bound that was hit is stated, not silently dropped. Hollow
          sections have no NC1 BY DESIGN — DSTV is an open-profile format — so they are
          reported here rather than filed as something to fix. */}
      <div className="mt-2 flex gap-4 text-xs text-slate-500 flex-wrap">
        <span>{q.saw_cut_no_nc1} sized, saw cut (no NC1 by design)</span>
        <span>{q.held_flat_pattern} held for a flat pattern</span>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn"; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${
      tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-white text-slate-700"}`}>
      {children}
    </div>
  );
}
