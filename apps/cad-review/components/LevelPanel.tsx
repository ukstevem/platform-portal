"use client";

import { useEffect, useState } from "react";
import { AssemblyViewer } from "./AssemblyViewer";

/**
 * Walk the assembly levels around a chosen one, and answer at whichever level is right.
 *
 * Steve, after the candidates list first offered a handrail's ball+tube sub-group instead of
 * the standard with its base plate: "would this resolve if we had the move up/down a level
 * again on the 'maybe bought out'?"
 *
 * Yes, and for a reason past convenience. The list picks its level by heuristic — count the
 * subtree, suppress nested. That heuristic is now right on this model and will be wrong on
 * some other one. A HEURISTIC NOBODY CAN OVERRULE IS WORSE THAN NONE, because its mistakes
 * stop being visible: you cannot tell a good suggestion from a bad one if the bad ones
 * cannot be corrected. Walking makes the mistake recoverable by the person looking, in the
 * moment, rather than by a bug report weeks later.
 */

type Member = {
  prototype_key: string; class: string | null;
  designation: string | null; name: string | null; instances: number;
};

type Level = {
  level: number;
  assembly_key: string | null;
  instance_prefix: string;
  members: Member[];
  distinct_prototypes: number;
  leaves: number;
  already_bought: number;
};

export function LevelPanel({ modelId, prefix, offeredKey, busy, onAnswer }: {
  modelId: string;
  prefix: string;
  offeredKey: string;
  busy: boolean;
  onAnswer: (assemblyKey: string, treatment: "unit" | "explode") => void;
}) {
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [at, setAt] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLevels(null); setErr(null);
    (async () => {
      try {
        const res = await fetch(
          `/cad-review/api/cad/models/${modelId}/levels/?prefix=${encodeURIComponent(prefix)}`,
          { cache: "no-store" });
        if (!res.ok) { setErr(`levels returned ${res.status}`); return; }
        const d = await res.json();
        setLevels(d.levels ?? []);
        setAt(d.start_index ?? 0);
      } catch { setErr("Could not reach the CAD service"); }
    })();
  }, [modelId, prefix]);

  if (err) return <Box><p className="text-sm text-amber-800">{err}</p></Box>;
  if (!levels?.length) return <Box><p className="text-sm text-slate-500">Loading levels…</p></Box>;

  const lv = levels[at];
  const isOffered = lv.assembly_key === offeredKey;
  const canAnswer = !!lv.assembly_key;

  return (
    <div className="space-y-2">
      <AssemblyViewer modelId={modelId} prefix={lv.instance_prefix}
                      className="h-[18rem] md:h-[22rem]" />

      <Box>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">
            {isOffered ? "Suggested level" : at < levels.findIndex((l) => l.assembly_key === offeredKey)
              ? "Inside it" : "Wider"}
          </span>
          <span className="text-xs text-slate-500 tabular-nums">
            {lv.distinct_prototypes} distinct · <b>{lv.leaves}</b> parts here
          </span>
          {lv.already_bought > 0 && (
            <span className="text-xs text-emerald-700">
              {lv.already_bought} already bought
            </span>
          )}
        </div>

        <div className="mt-1.5 max-h-24 overflow-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <tbody>
              {lv.members.map((m) => (
                <tr key={m.prototype_key} className="border-b border-slate-100 last:border-0">
                  <td className="px-2 py-0.5 text-slate-400">{m.class ?? "—"}</td>
                  <td className="px-2 py-0.5">{m.designation ?? ""}</td>
                  <td className="max-w-0 truncate px-2 py-0.5 text-slate-600">{m.name ?? ""}</td>
                  <td className="px-2 py-0.5 text-right tabular-nums">×{m.instances}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button disabled={at <= 0 || busy} onClick={() => setAt(at - 1)}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40">
            ↓ Inside
          </button>
          <button disabled={at + 1 >= levels.length || busy} onClick={() => setAt(at + 1)}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40">
            ↑ Wider
          </button>
          {!isOffered && (
            <span className="text-xs text-slate-400">not the suggested level</span>
          )}
        </div>

        {/* Answer at whatever level is on screen, not at the one the list guessed. */}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            disabled={!canAnswer || busy}
            onClick={() => lv.assembly_key && onAnswer(lv.assembly_key, "unit")}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            Bought — this level
          </button>
          <button
            disabled={!canAnswer || busy}
            onClick={() => lv.assembly_key && onAnswer(lv.assembly_key, "explode")}
            title="We fabricate this — explode it and keep its parts as separate items"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            Explode — we make this
          </button>
        </div>
        {!canAnswer && (
          <p className="mt-1.5 text-xs text-slate-400">
            This level has no assembly identity — step inside or wider.
          </p>
        )}
      </Box>
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">{children}</div>
  );
}
