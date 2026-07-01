// Client-side CSV export helpers, shared by the list screens (Orders,
// Operations, Order Status). Kept framework-free so any component can use them.

export function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

// Trigger a browser download of `csv` as `filename`. Prepends a UTF-8 BOM so
// Excel opens Indian text / ₹ correctly.
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
