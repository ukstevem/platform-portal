"use client";

/**
 * Shared cutting list results view — mirrors the PDF template layout.
 *
 * Used by both the main NestingPage (after job completes) and the
 * History page (when viewing a past job's results).
 */

/* ------------------------------------------------------------------ */
/*  Colour palette (matches PDF template)                              */
/* ------------------------------------------------------------------ */

const PRIMARY = "#2563eb";
const GREEN = "#16a34a";
const AMBER = "#d97706";
const RED = "#dc2626";
const SLATE = "#64748b";

const CUT_COLOURS = [
  "#93c5fd", "#a5b4fc", "#86efac", "#fde68a",
  "#fca5a5", "#c4b5fd", "#67e8f9", "#fdba74",
];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CutEntry = {
  cut_no: number;
  ref_id: string;
  member: string;
  parent: string;
  length_mm: number;
};

type Bar = {
  bar_label: string;
  stock_id: string;
  stock_length_mm: number;
  used_length_mm: number;
  waste_mm: number;
  cuts: CutEntry[];
};

type SectionResult = {
  designation: string;
  items_placed: number;
  items_unassigned: number;
  phase1_status: string;
  phase2_status: string;
  summary: {
    stocks_used: number;
    total_waste_mm: number;
    items_placed: number;
    items_unassigned: number;
  };
  bars: Bar[];
  unassigned: { item_index: number; ref_id: string; length: number }[];
};

export type CuttingList = {
  job_label: string;
  totals: {
    sections_processed: number;
    total_stocks_used: number;
    total_waste_mm: number;
    total_items_placed: number;
    total_items_unassigned: number;
  };
  sections: SectionResult[];
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusColour(status: string): string {
  if (status === "optimal") return GREEN;
  if (status === "feasible") return AMBER;
  return SLATE;
}

function overallUtilisation(sections: SectionResult[]): number {
  let totalStock = 0;
  let totalUsed = 0;
  for (const sec of sections) {
    for (const bar of sec.bars) {
      totalStock += bar.stock_length_mm;
      totalUsed += bar.used_length_mm;
    }
  }
  return totalStock > 0 ? Math.round((totalUsed / totalStock) * 100) : 0;
}

function sectionUtilisation(sec: SectionResult): number {
  let stock = 0;
  let used = 0;
  for (const bar of sec.bars) {
    stock += bar.stock_length_mm;
    used += bar.used_length_mm;
  }
  return stock > 0 ? Math.round((used / stock) * 100) : 0;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function CuttingListView({
  result,
  taskId,
}: {
  result: CuttingList;
  taskId?: string | null;
}) {
  const util = overallUtilisation(result.sections);
  const { totals } = result;

  function downloadPdf() {
    if (taskId) window.open(`/nesting/api/nesting/cutting-list/${taskId}/pdf`, "_blank");
  }

  function downloadCsv() {
    if (taskId) window.open(`/nesting/api/nesting/cutting-list/${taskId}/csv`, "_blank");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2
          className="text-lg font-semibold"
          style={{ color: "var(--pss-navy)" }}
        >
          Cutting List{result.job_label ? ` — ${result.job_label}` : ""}
        </h2>
        {taskId && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={downloadPdf}
              className="px-4 py-1.5 rounded text-sm font-medium text-white cursor-pointer"
              style={{ backgroundColor: "var(--pss-navy)" }}
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              className="px-4 py-1.5 rounded text-sm font-medium border cursor-pointer hover:bg-gray-50"
            >
              Download CSV
            </button>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="flex flex-wrap gap-3">
        <KpiCard value={String(totals.total_items_placed)} label="Placed" colour={PRIMARY} />
        <KpiCard value={String(totals.total_stocks_used)} label="Bars Used" colour={PRIMARY} />
        <KpiCard value={`${util}%`} label="Utilisation" colour={PRIMARY} />
        <KpiCard
          value={`${(totals.total_waste_mm / 1000).toFixed(1)} m`}
          label="Total Waste"
          colour={PRIMARY}
        />
        {totals.total_items_unassigned > 0 && (
          <KpiCard
            value={String(totals.total_items_unassigned)}
            label="Unassigned"
            colour={RED}
          />
        )}
      </div>

      {/* Synopsis table */}
      <div className="border rounded overflow-auto">
        <table className="text-sm w-full border-collapse">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="text-left px-3 py-2 border-b font-medium">Section</th>
              <th className="text-center px-3 py-2 border-b font-medium">Placed</th>
              <th className="text-center px-3 py-2 border-b font-medium">Bars</th>
              <th className="text-left px-3 py-2 border-b font-medium w-48">Utilisation</th>
              <th className="text-left px-3 py-2 border-b font-medium">Waste</th>
              <th className="text-center px-3 py-2 border-b font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.sections.map((sec) => {
              const secUtil = sectionUtilisation(sec);
              const wasteStr =
                sec.summary.total_waste_mm > 0
                  ? `${(sec.summary.total_waste_mm / 1000).toFixed(1)} m`
                  : "—";

              return (
                <tr key={sec.designation}>
                  <td className="px-3 py-2 font-medium">{sec.designation}</td>
                  <td className="px-3 py-2 text-center">{sec.summary.items_placed}</td>
                  <td className="px-3 py-2 text-center">{sec.summary.stocks_used}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 rounded bg-gray-200 overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{ width: `${secUtil}%`, backgroundColor: PRIMARY }}
                        />
                      </div>
                      <span className="text-xs font-semibold">{secUtil}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm">{wasteStr}</td>
                  <td className="px-3 py-2 text-center">
                    <StatusBadge status={sec.phase1_status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Per-section detail */}
      {result.sections.map((sec) => (
        <SectionDetail key={sec.designation} section={sec} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function KpiCard({
  value,
  label,
  colour,
}: {
  value: string;
  label: string;
  colour: string;
}) {
  return (
    <div className="border rounded-md px-5 py-2 text-center bg-[#f8fafc] min-w-[90px]">
      <p className="text-xl font-bold leading-tight" style={{ color: colour }}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mt-0.5">
        {label}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="inline-block text-[11px] font-semibold text-white px-2.5 py-0.5 rounded"
      style={{ backgroundColor: statusColour(status) }}
    >
      {status}
    </span>
  );
}

function SectionDetail({ section }: { section: SectionResult }) {
  return (
    <div className="border rounded">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <h3 className="font-semibold" style={{ color: "var(--pss-navy)" }}>
          {section.designation}
          <span className="font-normal text-sm text-gray-400 ml-2">
            — {section.summary.items_placed} placed, {section.summary.stocks_used} bars
          </span>
        </h3>
        <StatusBadge status={section.phase1_status} />
      </div>

      <div className="px-4 pb-4 space-y-4">
        {section.bars.map((bar) => (
          <BarDetail key={bar.stock_id} bar={bar} />
        ))}

        {section.unassigned.length > 0 && (
          <div className="rounded bg-amber-50 border border-amber-200 px-4 py-2.5">
            <p className="text-xs font-semibold" style={{ color: AMBER }}>
              Unassigned ({section.unassigned.length})
            </p>
            <div className="mt-1 text-xs text-amber-800 space-y-0.5">
              {section.unassigned.map((u, i) => (
                <p key={i}>
                  {u.ref_id || `#${u.item_index}`} — {u.length} mm
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BarDetail({ bar }: { bar: Bar }) {
  const usePct =
    bar.stock_length_mm > 0
      ? Math.round((bar.used_length_mm / bar.stock_length_mm) * 100)
      : 0;

  const wastePct =
    bar.stock_length_mm > 0
      ? (bar.waste_mm / bar.stock_length_mm) * 100
      : 0;

  return (
    <div>
      {/* Bar header */}
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-sm font-semibold">{bar.bar_label}</span>
        <span className="text-xs text-gray-400">
          {bar.stock_length_mm} mm&ensp;|&ensp;{usePct}% used&ensp;|&ensp;waste: {bar.waste_mm} mm
        </span>
      </div>

      {/* Visual bar */}
      <div className="w-full bg-gray-200 rounded h-6 flex overflow-hidden mb-2">
        {bar.cuts.map((cut, i) => {
          const pct = (cut.length_mm / bar.stock_length_mm) * 100;
          return (
            <div
              key={i}
              className="h-full border-r border-white flex items-center justify-center overflow-hidden"
              style={{
                width: `${pct}%`,
                backgroundColor: CUT_COLOURS[i % CUT_COLOURS.length],
              }}
              title={`${cut.member || cut.ref_id || ""}: ${cut.length_mm} mm`}
            >
              <span className="text-[10px] font-semibold text-gray-800 truncate px-0.5">
                {cut.length_mm}
              </span>
            </div>
          );
        })}
        {/* Waste block */}
        {wastePct > 0 && (
          <div
            className="h-full flex items-center justify-center overflow-hidden"
            style={{
              width: `${wastePct}%`,
              background: "repeating-linear-gradient(45deg, #e2e8f0, #e2e8f0 2px, #f1f5f9 2px, #f1f5f9 4px)",
            }}
            title={`Waste: ${bar.waste_mm} mm`}
          >
            {wastePct > 4 && (
              <span className="text-[10px] text-gray-400 truncate px-0.5">
                {bar.waste_mm}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Cuts table */}
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
            <th className="text-left py-1 pr-2 border-b font-medium w-8">#</th>
            <th className="text-left py-1 pr-2 border-b font-medium">Member</th>
            <th className="text-left py-1 pr-2 border-b font-medium">Parent</th>
            <th className="text-right py-1 border-b font-medium">Length</th>
          </tr>
        </thead>
        <tbody>
          {bar.cuts.map((cut) => (
            <tr key={cut.cut_no} className="hover:bg-gray-50/60">
              <td className="py-0.5 pr-2">{cut.cut_no}</td>
              <td className="py-0.5 pr-2">{cut.member || cut.ref_id || "—"}</td>
              <td className="py-0.5 pr-2 text-gray-500">{cut.parent || "—"}</td>
              <td className="py-0.5 text-right font-mono">{cut.length_mm} mm</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
