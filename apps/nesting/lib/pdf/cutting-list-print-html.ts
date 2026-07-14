import { PSS_LOGO_DATA_URI } from "./logo";

// Self-contained cutting-list print document for pss-pdf-service (JS disabled,
// external fetches blocked there): inline CSS, data-URI logo, no footer / page
// number / printed-date furniture (the doc-service stamps the doc number into
// the footer). Ports the PDFKit template from pss-document-service
// (src/nesting/templates/cutting-list.ts) to HTML/CSS. Rendered landscape A4
// via the page field on the render/file call. Epic platform-portal-6gr.2.

// ─── Types (mirror the /cutting-list JSON from pss-nesting-service) ──────────
interface Cut {
  cut_no: number;
  ref_id?: string | null;
  member?: string | null;
  parent?: string | null;
  length_mm: number;
}
interface Bar {
  bar_label: string;
  stock_length_mm: number;
  used_length_mm: number;
  waste_mm: number;
  cuts: Cut[];
}
interface SectionSummary {
  stocks_used: number;
  total_waste_mm: number;
  items_placed: number;
  items_unassigned: number;
}
interface Unassigned {
  item_index: number;
  ref_id?: string | null;
  member_name?: string | null;
  length: number;
}
interface Section {
  designation: string;
  comments?: string | null;
  phase1_status: string;
  phase2_status?: string | null;
  summary: SectionSummary;
  bars: Bar[];
  unassigned: Unassigned[];
}
interface Totals {
  total_stocks_used: number;
  total_waste_mm: number;
  total_items_placed: number;
  total_items_unassigned: number;
}
export interface CuttingListData {
  job_label?: string | null;
  run_at?: string;
  totals: Totals;
  sections: Section[];
}

export interface CuttingListPrintResult {
  html: string;
  footerLeft: string;
  fileName: string;
}
export interface CuttingListPrintOptions {
  /** Diagonal per-page watermark; previews set this, filing never does. */
  watermark?: string;
}

// ─── Branding (from the PDFKit template) ─────────────────────────────────────
const CUT_COLOURS = [
  "#93c5fd", "#a5b4fc", "#86efac", "#fde68a",
  "#fca5a5", "#c4b5fd", "#67e8f9", "#fdba74",
];

const CSS = `
* { box-sizing: border-box; }
body { font-family: 'Montserrat', Arial, Helvetica, sans-serif; font-size: 8pt; color: #1e293b; margin: 0; }
.head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4mm; }
.head img { height: 46px; display: block; }
.company { font-size: 7pt; color: #64748b; text-align: right; line-height: 1.45; }
h1 { font-size: 14pt; color: #1a3a5c; margin: 0 0 1mm; }
.subtitle { font-size: 7.5pt; color: #64748b; margin-bottom: 3mm; }
.kpis { display: flex; gap: 3mm; margin-bottom: 3mm; }
.kpi { border: 0.3mm solid #e2e8f0; border-radius: 1mm; padding: 2mm 3mm; text-align: center; min-width: 24mm; }
.kpi .v { font-size: 13pt; font-weight: 700; color: #2563eb; line-height: 1.1; }
.kpi.warn .v { color: #dc2626; }
.kpi .l { font-size: 5.5pt; text-transform: uppercase; letter-spacing: .5pt; color: #64748b; margin-top: .8mm; }
.consumed { font-size: 8pt; margin-bottom: 4mm; }
.consumed .lab { font-weight: 700; color: #64748b; text-transform: uppercase; font-size: 7pt; margin-right: 2mm; }
table.syn { width: 100%; border-collapse: collapse; margin-bottom: 5mm; font-size: 7.5pt; }
table.syn th { text-align: left; color: #64748b; font-size: 6.5pt; text-transform: uppercase; border-bottom: 0.3mm solid #e2e8f0; padding: 1mm; }
table.syn td { padding: 1mm; border-bottom: 0.2mm solid #f1f5f9; vertical-align: middle; }
.util { display: inline-block; width: 34mm; height: 2.4mm; background: #e2e8f0; border-radius: 1mm; overflow: hidden; vertical-align: middle; margin-right: 2mm; }
.util > span { display: block; height: 100%; background: #2563eb; }
.badge { display: inline-block; padding: .4mm 2mm; border-radius: 1mm; color: #fff; font-size: 6.5pt; font-weight: 700; }
.section { break-inside: avoid; margin-bottom: 5mm; }
.section h2 { font-size: 10pt; color: #1a3a5c; margin: 0 0 1mm; display: flex; justify-content: space-between; align-items: center; }
.section h2 .sub { font-weight: 400; font-size: 8pt; color: #64748b; }
.sec-consumed { font-size: 7pt; color: #64748b; margin-bottom: 2mm; }
.note { background: #dbeafe; border-radius: 1mm; padding: 2mm 3mm; margin-bottom: 2mm; }
.note .lab { font-weight: 700; font-size: 6.5pt; color: #1a3a5c; }
.note .body { font-style: italic; font-size: 8pt; }
.bar { break-inside: avoid; margin-bottom: 3mm; }
.bar .bh { font-size: 7.5pt; margin-bottom: 1mm; }
.bar .bh b { font-size: 8pt; color: #1e293b; }
.bar .bh span { color: #64748b; }
.vis { display: flex; width: 100%; height: 5mm; background: #e2e8f0; border-radius: 0.6mm; overflow: hidden; }
.vis .seg { height: 100%; border-right: 0.3mm solid #fff; font-size: 5.5pt; font-weight: 700; color: #1e293b; text-align: center; line-height: 5mm; overflow: hidden; white-space: nowrap; }
.vis .waste { height: 100%; flex: 1 1 auto; color: #64748b; font-size: 5.5pt; text-align: center; line-height: 5mm; }
table.cuts { width: 100%; border-collapse: collapse; margin-top: 1mm; font-size: 7pt; }
table.cuts th { text-align: left; color: #64748b; font-size: 6pt; text-transform: uppercase; border-bottom: 0.3mm solid #e2e8f0; padding: .6mm 1mm; }
table.cuts td { padding: .6mm 1mm; border-bottom: 0.2mm solid #f8fafc; }
table.cuts td.n, table.cuts th.n { text-align: right; }
.unassigned { background: #fef3c7; border-radius: 1mm; padding: 2mm 3mm; margin-top: 2mm; font-size: 7.5pt; color: #92400e; }
.unassigned .lab { font-weight: 700; color: #d97706; display: block; margin-bottom: 1mm; }
.watermark { position: fixed; top: 45%; left: 0; width: 100%; text-align: center; transform: rotate(-30deg); font-size: 34pt; font-weight: 700; letter-spacing: 2pt; color: rgba(180,30,30,0.18); pointer-events: none; z-index: 999; }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = d.toLocaleString("en-GB", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd} ${mmm} ${d.getFullYear()}  ${hh}:${min}`;
}

function statusColour(status: string): string {
  if (status === "optimal") return "#16a34a";
  if (status === "feasible") return "#d97706";
  return "#64748b";
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Roll up bars consumed, grouped by length, longest first. */
function stockConsumption(bars: { stock_length_mm: number }[]): string {
  const counts = new Map<number, number>();
  for (const b of bars) counts.set(b.stock_length_mm, (counts.get(b.stock_length_mm) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[0] - a[0]);
  const total = groups.reduce((s, [, q]) => s + q, 0);
  if (total === 0) return "0 bars";
  return `${total} bars: ${groups.map(([len, q]) => `${q}@${len}`).join(", ")}`;
}

function wasteStr(mm: number): string {
  return mm > 0 ? `${(mm / 1000).toFixed(1)} m` : "—";
}

// ─── Builder ─────────────────────────────────────────────────────────────────
export function buildCuttingListHtml(
  data: CuttingListData,
  options: CuttingListPrintOptions = {}
): CuttingListPrintResult {
  const sections = data.sections ?? [];
  const totals = data.totals;
  const allBars = sections.flatMap((s) => s.bars ?? []);
  const overallUtil = pct(
    allBars.reduce((s, b) => s + b.used_length_mm, 0),
    allBars.reduce((s, b) => s + b.stock_length_mm, 0)
  );

  // KPI cards
  const kpis: { v: string; l: string; warn?: boolean }[] = [
    { v: String(totals.total_items_placed), l: "Placed" },
    { v: String(totals.total_stocks_used), l: "Bars Used" },
    { v: `${overallUtil}%`, l: "Utilisation" },
    { v: `${(totals.total_waste_mm / 1000).toFixed(1)} m`, l: "Total Waste" },
  ];
  if (totals.total_items_unassigned > 0) {
    kpis.push({ v: String(totals.total_items_unassigned), l: "Unassigned", warn: true });
  }
  const kpiHtml = kpis
    .map((k) => `<div class="kpi${k.warn ? " warn" : ""}"><div class="v">${esc(k.v)}</div><div class="l">${esc(k.l)}</div></div>`)
    .join("");

  // Synopsis rows
  const synRows = sections
    .map((sec) => {
      const summ = sec.summary;
      const secBars = sec.bars ?? [];
      const util = pct(
        secBars.reduce((s, b) => s + b.used_length_mm, 0),
        secBars.reduce((s, b) => s + b.stock_length_mm, 0)
      );
      return `<tr>
  <td>${esc(sec.designation)}</td>
  <td>${summ.items_placed}</td>
  <td>${summ.stocks_used}</td>
  <td><span class="util"><span style="width:${util}%"></span></span>${util}%</td>
  <td>${wasteStr(summ.total_waste_mm)}</td>
  <td><span class="badge" style="background:${statusColour(sec.phase1_status)}">${esc(sec.phase1_status)}</span></td>
</tr>`;
    })
    .join("");

  // Per-section detail
  const sectionHtml = sections
    .map((sec) => {
      const secBars = sec.bars ?? [];

      const note = sec.comments && sec.comments.trim()
        ? `<div class="note"><span class="lab">Operator note</span><div class="body">${esc(sec.comments.trim())}</div></div>`
        : "";

      const barsHtml = secBars
        .map((bar) => {
          const use = pct(bar.used_length_mm, bar.stock_length_mm);
          const segs = (bar.cuts ?? [])
            .map((cut, i) => {
              const w = bar.stock_length_mm > 0 ? (cut.length_mm / bar.stock_length_mm) * 100 : 0;
              const colour = CUT_COLOURS[i % CUT_COLOURS.length];
              return `<div class="seg" style="width:${w.toFixed(3)}%;background:${colour}">${w > 4 ? cut.length_mm : ""}</div>`;
            })
            .join("");
          const wasteSeg = bar.waste_mm > 0
            ? `<div class="waste">${bar.waste_mm}</div>`
            : "";

          const cutRows = (bar.cuts ?? [])
            .map(
              (cut) => `<tr><td>${cut.cut_no}</td><td>${esc(cut.member || cut.ref_id || "—")}</td><td>${esc(cut.parent || "—")}</td><td class="n">${cut.length_mm} mm</td></tr>`
            )
            .join("");

          return `<div class="bar">
  <div class="bh"><b>${esc(bar.bar_label)}</b> <span>&nbsp;${bar.stock_length_mm} mm &nbsp;|&nbsp; ${use}% used &nbsp;|&nbsp; waste: ${bar.waste_mm} mm</span></div>
  <div class="vis">${segs}${wasteSeg}</div>
  <table class="cuts">
    <thead><tr><th>#</th><th>Member</th><th>Parent</th><th class="n">Length</th></tr></thead>
    <tbody>${cutRows}</tbody>
  </table>
</div>`;
        })
        .join("");

      const unassignedHtml = (sec.unassigned ?? []).length > 0
        ? `<div class="unassigned"><span class="lab">Unassigned (${sec.unassigned.length})</span>${sec.unassigned
            .map((u) => `${esc(u.member_name || u.ref_id || `#${u.item_index}`)} — ${u.length} mm`)
            .join("<br>")}</div>`
        : "";

      return `<div class="section">
  <h2><span>${esc(sec.designation)} <span class="sub">— ${sec.summary.items_placed} placed, ${sec.summary.stocks_used} bars</span></span><span class="badge" style="background:${statusColour(sec.phase1_status)}">${esc(sec.phase1_status)}</span></h2>
  <div class="sec-consumed">Stock consumed: ${esc(stockConsumption(secBars))}</div>
  ${note}
  ${barsHtml}
  ${unassignedHtml}
</div>`;
    })
    .join("");

  const label = (data.job_label ?? "").trim();
  const watermark = options.watermark ? `<div class="watermark">${esc(options.watermark)}</div>` : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
${watermark}<div class="head">
  <div><img src="${PSS_LOGO_DATA_URI}" alt="PSS"></div>
  <div class="company">Power System Services<br>Carrwood Road, Chesterfield, S41 9QB<br>01246 268929</div>
</div>
<h1>Cutting List${label ? ` — ${esc(label)}` : ""}</h1>
<div class="subtitle">${data.run_at ? `Nesting run: ${esc(fmtDate(data.run_at))}` : ""}</div>
<div class="kpis">${kpiHtml}</div>
<div class="consumed"><span class="lab">Stock consumed</span>${esc(stockConsumption(allBars))}</div>
<table class="syn">
  <thead><tr><th>Section</th><th>Placed</th><th>Bars</th><th>Utilisation</th><th>Waste</th><th>Status</th></tr></thead>
  <tbody>${synRows}</tbody>
</table>
${sectionHtml}
</body></html>`;

  return {
    html,
    footerLeft: label ? `Cutting List ${label}` : "Cutting List",
    fileName: `Cutting List${label ? ` ${label}` : ""}.pdf`,
  };
}
