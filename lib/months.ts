// Month helpers, shared by the month filter and the monthly report.
// Everything is UTC and YYYY-MM, matching how order_date is stored and how the
// rest of the app builds date strings.

export type MonthKey = string; // "2026-05"

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// "2026-05-17" → "2026-05"
export function monthOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

// "2026-05" → "May 2026"
export function monthLabel(key: MonthKey): string {
  const [y, m] = key.split("-");
  const i = Number(m) - 1;
  return i >= 0 && i < 12 ? `${MONTH_NAMES[i]} ${y}` : key;
}

// "2026-05" → the inclusive date range covering that month.
export function monthRange(key: MonthKey): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  // Day 0 of the NEXT month is the last day of this one.
  const last = new Date(Date.UTC(y, m, 0));
  return { from: `${key}-01`, to: last.toISOString().slice(0, 10) };
}

// True when [from, to] is exactly one whole month — used to show the month
// filter as selected when the dates happen to line up.
export function monthOfRange(from: string, to: string): MonthKey | null {
  if (!from || !to || monthOf(from) !== monthOf(to)) return null;
  const r = monthRange(monthOf(from));
  return r.from === from && r.to === to ? monthOf(from) : null;
}

// Every month from `first` to `last` inclusive, oldest first. Gaps are kept: a
// month with no orders is information, not something to hide.
export function monthsBetween(first: MonthKey, last: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  const [fy, fm] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  if (!fy || !fm || !ly || !lm) return out;
  let y = fy;
  let m = fm;
  // Guard against a bad `first` (e.g. a typo'd order date far in the past)
  // turning this into an unbounded loop.
  for (let i = 0; i < 600 && (y < ly || (y === ly && m <= lm)); i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
