"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The bill of materials: every line with a picture, a size, a box and a weight (bd 3ytz).
 *
 * Steve, on the pipeline as a whole: "whilst the backend and geometry is tighter and more
 * reliable than stage2, the user can run stage 2, whereas we cant do that with stage3 yet, its
 * kind of headless." Driving job 10364 end to end took eight steps and five of them needed an
 * agent — every one at the OUTPUT end. This is the first of the three that close that gap.
 *
 * THE PICTURE IS THE POINT. A BOM identifies a part by mark and designation, and both are
 * labels; the picture is the only column that can be checked against a drawing. It has already
 * mattered twice on real jobs — two handrail standards that both read "63mm ball" and could not
 * be told apart from a list, and a 320 mm base plate at 45 degrees that stage2 measured as 452
 * square (its own diagonal) with nothing to look at that would have shown it.
 *
 * MAKE FIRST, HEAVIEST FIRST. A BOM ordered by node id is a database dump. What is bought or
 * excluded is listed too, never dropped: on 10353 the raw total was 45.8 t of which only 10.2
 * was steelwork, and a page that quietly omitted the rest would have been quoted as fabrication.
 */

type Row = {
  fingerprint_key: string;
  mark: string | null;
  name: string | null;
  assembly_name: string | null;
  designation: string | null;
  class: string | null;
  make_or_buy: string | null;
  material_grade: string | null;
  qty: number;
  n_solids: number;
  mass_kg: number | null;
  line_mass_kg: number | null;
  dim_x: number | null;
  dim_y: number | null;
  dim_z: number | null;
  cut_file: string | null;
};

const CLASS_TONE: Record<string, string> = {
  SECTION: "bg-sky-100 text-sky-800",
  PLATE: "bg-emerald-100 text-emerald-800",
  FORMED_PLATE: "bg-amber-100 text-amber-900",
  TUBE: "bg-sky-100 text-sky-800",
  BOUGHT_OUT: "bg-emerald-100 text-emerald-800",
  FREE_ISSUE: "bg-violet-100 text-violet-800",
  EXCLUDE: "bg-slate-200 text-slate-600",
};

const box = (r: Row) =>
  [r.dim_x ?? 0, r.dim_y ?? 0, r.dim_z ?? 0].sort((a, b) => b - a);

export function BomTable({ modelId, projectRef }: {
  modelId: string; projectRef?: string | null;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPics, setShowPics] = useState(true);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/cad-review/api/cad/models/${modelId}/bom/`,
                              { cache: "no-store" });
      if (!res.ok) { setErr(`BOM returned ${res.status}`); return; }
      setRows(await res.json());
    } catch { setErr("Could not reach the CAD service"); }
  }, [modelId]);

  useEffect(() => { load(); }, [load]);

  const { make, free, other, totals } = useMemo(() => {
    const all = rows ?? [];
    const order = (r: Row) => (r.make_or_buy === "make" ? 0 : r.make_or_buy === "buy" ? 1
                             : r.make_or_buy === "free_issue" ? 2 : 3);
    const sorted = [...all].sort(
      (a, b) => order(a) - order(b) || (b.line_mass_kg ?? 0) - (a.line_mass_kg ?? 0));
    const t = { pieces: 0, make: 0, buy: 0, free: 0, other: 0, nc1: 0, dxf: 0 };
    for (const r of all) {
      t.pieces += r.qty ?? 0;
      const m = r.line_mass_kg ?? 0;
      if (r.make_or_buy === "make") t.make += m;
      else if (r.make_or_buy === "buy") t.buy += m;
      // Free issue is totalled on its own: the client supplies it, so it is neither steel we
      // fabricate nor something we buy, and a quote must not price it as either.
      else if (r.make_or_buy === "free_issue") t.free += m;
      else t.other += m;
      if (r.cut_file === "nc1") t.nc1 += 1;
      if (r.cut_file === "dxf") t.dxf += 1;
    }
    return {
      make: sorted.filter((r) => r.make_or_buy === "make"),
      free: sorted.filter((r) => r.make_or_buy === "free_issue"),
      other: sorted.filter((r) => r.make_or_buy !== "make" && r.make_or_buy !== "free_issue"),
      totals: t,
    };
  }, [rows]);

  function downloadCsv() {
    const cols = ["mark", "name", "assembly", "designation", "class", "make_or_buy", "grade",
                  "qty", "length_mm", "width_mm", "height_mm", "mass_each_kg", "mass_total_kg",
                  "cut_file", "solids"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // Every list, in page order. Splitting free issue out of `other` without adding it here
    // would have dropped the client's equipment from the download while the page still showed it.
    const body = [...make, ...free, ...other].map((r) => {
      const d = box(r);
      return [r.mark, r.name, r.assembly_name, r.designation, r.class, r.make_or_buy,
              r.material_grade, r.qty, d[0].toFixed(1), d[1].toFixed(1), d[2].toFixed(1),
              (r.mass_kg ?? 0).toFixed(2), (r.line_mass_kg ?? 0).toFixed(2),
              r.cut_file ?? "", r.n_solids].map(esc).join(",");
    });
    const csv = [cols.join(","), ...body].join("\n");
    // A blob URL, because the page has the data already and a round trip would only re-fetch it.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${projectRef || modelId.slice(0, 8)}_bom.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (err) return <Warn>{err}</Warn>;
  if (!rows) return <p className="text-sm text-slate-500">Reading the bill of materials…</p>;

  const t = totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Stat label="pieces" value={t.pieces.toLocaleString()} />
          <Stat label="fabricated" value={`${(t.make / 1000).toFixed(2)} t`} tone="text-emerald-700" />
          {t.buy > 0 && <Stat label="bought" value={`${(t.buy / 1000).toFixed(2)} t`} />}
          {t.free > 0 && <Stat label="free issue" value={`${(t.free / 1000).toFixed(2)} t`}
                               tone="text-violet-700" />}
          {t.other > 0 && <Stat label="excluded" value={`${(t.other / 1000).toFixed(2)} t`} />}
          <Stat label="cut files" value={`${t.nc1} NC1 · ${t.dxf} DXF`} />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showPics}
                   onChange={(e) => setShowPics(e.target.checked)} />
            Pictures
          </label>
          <button onClick={downloadCsv}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Download CSV
          </button>
        </div>
      </div>

      {/* The split is the headline, not a footnote: on 10353 the raw total was 45.8 t and only
          10.2 of it was steelwork. */}
      {t.buy + t.free + t.other > 0 && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
          <strong>{(t.make / 1000).toFixed(2)} t</strong> is fabricated steel.
          {t.free > 0 && (
            <> <strong>{(t.free / 1000).toFixed(2)} t</strong> is free issue — supplied by the
            client, and not priced.</>
          )}{" "}
          The other <strong>{((t.buy + t.other) / 1000).toFixed(2)} t</strong> is bought or
          excluded and is not steelwork to price.
        </p>
      )}

      <Section title="What we make" rows={make} showPics={showPics} modelId={modelId} />
      {free.length > 0 && (
        <Section title="Free issue — supplied by the client" rows={free} showPics={showPics}
                 modelId={modelId} muted />
      )}
      {other.length > 0 && (
        <Section title="Bought or excluded" rows={other} showPics={showPics} modelId={modelId}
                 muted />
      )}
    </div>
  );
}

function Section({ title, rows, showPics, modelId, muted }: {
  title: string; rows: Row[]; showPics: boolean; modelId: string; muted?: boolean;
}) {
  if (rows.length === 0) return null;
  const pieces = rows.reduce((n, r) => n + (r.qty ?? 0), 0);
  const kg = rows.reduce((n, r) => n + (r.line_mass_kg ?? 0), 0);
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium">
        {title}
        <span className="ml-2 text-xs font-normal tabular-nums text-slate-500">
          {rows.length} line{rows.length === 1 ? "" : "s"} · {pieces} pieces · {kg.toFixed(0)} kg
        </span>
      </h3>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              {showPics && <th className="px-3 py-2 w-[104px]" />}
              <th className="px-3 py-2 text-left font-medium">Mark</th>
              <th className="px-3 py-2 text-left font-medium">Part</th>
              <th className="px-3 py-2 text-left font-medium">Section</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Box (mm)</th>
              <th className="px-3 py-2 text-right font-medium">kg each</th>
              <th className="px-3 py-2 text-right font-medium">kg total</th>
              <th className="px-3 py-2 text-left font-medium">Cut file</th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-slate-100 ${muted ? "text-slate-500" : ""}`}>
            {rows.map((r) => {
              const d = box(r);
              return (
                <tr key={r.fingerprint_key} className="hover:bg-slate-50">
                  {showPics && (
                    <td className="px-3 py-1.5">
                      {/* Lazy, because a job is sixty of these and only a few are on screen. */}
                      <img loading="lazy" alt={r.name ?? ""}
                           src={`/cad-review/api/cad/models/${modelId}/prototype/${r.fingerprint_key}/thumbnail/`}
                           className="h-[58px] w-[86px] rounded bg-slate-100 object-contain" />
                    </td>
                  )}
                  <td className="px-3 py-1.5 font-mono text-xs">{r.mark || "—"}</td>
                  <td className="px-3 py-1.5">
                    <span className="block max-w-[22rem] truncate">{r.name || "—"}</span>
                    {r.assembly_name && (
                      <span className="block max-w-[22rem] truncate text-xs text-slate-500">
                        {r.assembly_name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.designation || "—"}</td>
                  <td className="px-3 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${
                      CLASS_TONE[r.class ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
                      {(r.class ?? "—").replace("_", " ").toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.qty}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500">
                    {d[0] ? `${d[0].toFixed(0)} × ${d[1].toFixed(0)} × ${d[2].toFixed(0)}` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {(r.mass_kg ?? 0).toFixed(1)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {(r.line_mass_kg ?? 0).toFixed(1)}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.cut_file ? (
                      <a href={`/cad-review/api/cad/models/${modelId}/prototype/${r.fingerprint_key}/artifact/${r.cut_file}/`}
                         className="font-mono text-xs text-slate-700 underline">
                        {r.cut_file}
                      </a>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="flex flex-col">
      <span className={`font-medium tabular-nums ${tone ?? ""}`}>{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </span>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </p>
  );
}
