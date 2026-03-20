import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";

type ExportRow = {
  name: string;
  employeeId: string;
  basic: number;
  sick: number;
  holiday: number;
  x15: number;
  x20: number;
  furlough: number;
  travel: number;
  bonus: number;
  subs: number;
  comments: string;
  otProjects: string;
};

type ExportParams = {
  rows: ExportRow[];
  weekISO: string;
  weekNumber: number;
  weekLabel: string;
};

function formatValPDF(v: number): string {
  return v > 0 ? v.toFixed(2) : "";
}

function formatCurrencyPDF(v: number): string {
  return v > 0 ? v.toFixed(2) : "";
}

// ── Shared styles ──
const PSS_NAVY = "061B37";
const BORDER_THIN = {
  top: { style: "thin", color: { rgb: "000000" } },
  bottom: { style: "thin", color: { rgb: "000000" } },
  left: { style: "thin", color: { rgb: "000000" } },
  right: { style: "thin", color: { rgb: "000000" } },
} as const;

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill: { fgColor: { rgb: PSS_NAVY } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: BORDER_THIN,
};

const TITLE_STYLE = {
  font: { bold: true, sz: 14, color: { rgb: PSS_NAVY } },
};

const SUBTITLE_STYLE = {
  font: { sz: 10, color: { rgb: "666666" } },
};

const CELL_TEXT = {
  font: { sz: 10 },
  alignment: { vertical: "center" as const },
  border: BORDER_THIN,
};

const CELL_NUM = {
  ...CELL_TEXT,
  alignment: { horizontal: "right" as const, vertical: "center" as const },
  numFmt: "0.00",
};

const CELL_CURRENCY = {
  ...CELL_TEXT,
  alignment: { horizontal: "right" as const, vertical: "center" as const },
  numFmt: "£#,##0.00",
};

const CELL_SICK = {
  ...CELL_NUM,
  font: { sz: 10, color: { rgb: "DC2626" } },
};

const CELL_OT15 = {
  ...CELL_NUM,
  font: { sz: 10, color: { rgb: "D97706" } },
};

const CELL_OT20 = {
  ...CELL_NUM,
  font: { sz: 10, color: { rgb: "DC2626" }, bold: true },
};

// ── PDF Export ──
export function exportPDF({ rows, weekISO, weekNumber, weekLabel }: ExportParams) {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(14);
  doc.text("Hourly Sheet & Wage Preparation", 14, 15);
  doc.setFontSize(10);
  doc.text(`Week ${weekNumber} — ${weekLabel} (${weekISO})`, 14, 22);

  const headers = [
    "Name", "Employee ID", "Basic", "Sick", "Holiday",
    "x1.5", "x2.0", "Furlough", "Travel", "Bonus (£)", "Subs (£)", "Comments",
  ];

  const body = rows.map((r) => [
    r.name,
    r.employeeId,
    formatValPDF(r.basic),
    formatValPDF(r.sick),
    formatValPDF(r.holiday),
    formatValPDF(r.x15),
    formatValPDF(r.x20),
    formatValPDF(r.furlough),
    formatValPDF(r.travel),
    formatCurrencyPDF(r.bonus),
    formatCurrencyPDF(r.subs),
    [r.otProjects, r.comments].filter(Boolean).join(" | "),
  ]);

  autoTable(doc, {
    head: [headers],
    body,
    startY: 28,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [6, 27, 55] },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right", textColor: [220, 38, 38] },
      4: { halign: "right" },
      5: { halign: "right", textColor: [217, 119, 6] },
      6: { halign: "right", textColor: [220, 38, 38] },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
    },
  });

  const yy = weekISO.slice(2, 4);
  const mm = weekISO.slice(5, 7);
  const dd = weekISO.slice(8, 10);
  doc.save(`wages-${yy}${mm}${dd}-wk${weekNumber}.pdf`);
}

// ── Excel helpers ──
function numCell(v: number, style: object): object {
  return v > 0 ? { v, t: "n", s: style } : { v: "", t: "s", s: { ...CELL_TEXT, alignment: { horizontal: "right", vertical: "center" } } };
}

function textCell(v: string, style?: object): object {
  return { v, t: "s", s: style ?? CELL_TEXT };
}

// ── Wage Prep Excel Export ──
export function exportXLSX({ rows, weekISO, weekNumber, weekLabel }: ExportParams) {
  const headerLabels = [
    "Name", "Employee ID", "Basic", "Sick", "Holiday",
    "x1.5", "x2.0", "Furlough", "Travel", "Bonus (£)", "Subs (£)", "Comments",
  ];

  const wsData: object[][] = [
    [{ v: "Hourly Sheet & Wage Preparation", t: "s", s: TITLE_STYLE }],
    [{ v: `Week ${weekNumber} — ${weekLabel}`, t: "s", s: SUBTITLE_STYLE }],
    headerLabels.map((h) => ({ v: h, t: "s", s: HEADER_STYLE })),
    ...rows.map((r) => [
      textCell(`${r.name}`),
      textCell(r.employeeId),
      numCell(r.basic, CELL_NUM),
      numCell(r.sick, CELL_SICK),
      numCell(r.holiday, CELL_NUM),
      numCell(r.x15, CELL_OT15),
      numCell(r.x20, CELL_OT20),
      numCell(r.furlough, CELL_NUM),
      numCell(r.travel, CELL_NUM),
      numCell(r.bonus, CELL_CURRENCY),
      numCell(r.subs, CELL_CURRENCY),
      textCell([r.otProjects, r.comments].filter(Boolean).join(" | ")),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Merge title across columns
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
  ];

  // Column widths
  ws["!cols"] = [
    { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 12 }, { wch: 42 },
  ];

  // Row heights
  ws["!rows"] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 22 }];

  const yy = weekISO.slice(2, 4);
  const mm = weekISO.slice(5, 7);
  const dd = weekISO.slice(8, 10);
  const sheetName = `${yy}-${mm}-${dd}-wk${weekNumber}`;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `wages-${yy}${mm}${dd}-wk${weekNumber}.xlsx`);
}
