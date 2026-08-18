// Why don't our party names match CRR customers?
//
// Method: run each unmatched name up a ladder of progressively looser
// normalisations. The FIRST rung that produces a match identifies the reason
// the strict rules missed it. Anything that survives the whole ladder is tested
// for near-neighbours (typo) before being called genuinely absent.
import "./load-env";
import fs from "node:fs";
import postgres from "postgres";

const CSV = "C:/Users/Admin/Downloads/crr_customer_alias_rows.csv";

// ---- normalisation ladder --------------------------------------------------
const SUFFIX =
  /\s+(PRIVATE LIMITED|PVT\.? ?LTD\.?|P\.? ?LTD\.?|LIMITED|LTD\.?|LLP|L\.L\.P\.|INCORPORATED|INC\.?|CORPORATION|CORP\.?)$/;

/** L1 — SCOT's scot_canon(), exactly as their spec describes it. */
function scotCanon(raw: string): string {
  let s = raw, p: string;
  do { p = s; s = s.replace(/(\s*\([^()]*\)\s*)+$/, ""); } while (s !== p);
  s = s.replace(/[.\s]+$/, "").replace(/\s+/g, " ").trim().toUpperCase();
  return s.replace(SUFFIX, "").trim();
}
/** L2 — also fold internal punctuation and spaces away entirely. */
const foldPunct = (s: string) => scotCanon(s).replace(/[^A-Z0-9]/g, "");
/** L3 — also treat CO and COMPANY as the same word. */
const foldCo = (s: string) =>
  scotCanon(s).replace(/\bCOMPANY\b/g, "CO").replace(SUFFIX, "").replace(/[^A-Z0-9]/g, "");
/** L4 — also ignore trailing plural S on every word. */
const foldPlural = (s: string) =>
  scotCanon(s).replace(/\bCOMPANY\b/g, "CO").replace(SUFFIX, "")
    .split(/[^A-Z0-9]+/).filter(Boolean).map((w) => w.replace(/S$/, "")).join("");
/** L5 — also drop common decorative prefixes/suffixes of Indian trade names. */
const NOISE = /\b(SHREE|SHRI|SREE|SRI|THE|M\/S|MS)\b/g;
const foldNoise = (s: string) =>
  scotCanon(s).replace(/\bCOMPANY\b/g, "CO").replace(SUFFIX, "").replace(NOISE, "")
    .split(/[^A-Z0-9]+/).filter(Boolean).map((w) => w.replace(/S$/, "")).join("");
/** token set, for containment tests (shortened / extended names). */
const tokens = (s: string) =>
  scotCanon(s).replace(/\bCOMPANY\b/g, "CO").split(/[^A-Z0-9]+/).filter(Boolean)
    .map((w) => w.replace(/S$/, ""));

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

// ---- load CRR --------------------------------------------------------------
type Crr = { id: string; full: string };
const crr: Crr[] = [];
for (const line of fs.readFileSync(CSV, "utf8").split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const i = line.indexOf(","), j = line.indexOf(",", i + 1);
  if (i < 0 || j < 0) continue;
  const full = line.slice(j + 1).replace(/^"|"$/g, "").trim();
  if (full) crr.push({ id: line.slice(0, i), full });
}
const LADDER = [
  { key: "exact", label: "Exact alias already on file", fn: (s: string) => s.trim().toUpperCase() },
  { key: "scot", label: "Matched by scot_canon as specified", fn: scotCanon },
  { key: "punct", label: "Spacing / punctuation around initials", fn: foldPunct },
  { key: "co", label: "CO vs COMPANY", fn: foldCo },
  { key: "plural", label: "Singular vs plural (GARMENT / GARMENTS)", fn: foldPlural },
  { key: "noise", label: "Decorative prefix (SHREE / SHRI / THE)", fn: foldNoise },
] as const;

const maps = LADDER.map(({ fn }) => {
  const m = new Map<string, Set<string>>();
  for (const c of crr) {
    const k = fn(c.full);
    if (!k) continue;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(c.id);
  }
  return m;
});
const crrTokens = crr.map((c) => ({ ...c, t: tokens(c.full), k: foldCo(c.full) }));

// ---- classify --------------------------------------------------------------
type Row = { name: string; orders: number };
function classify(name: string) {
  for (let i = 0; i < LADDER.length; i++) {
    const hit = maps[i].get(LADDER[i].fn(name));
    if (hit?.size) return { rung: LADDER[i].key, label: LADDER[i].label, example: "" };
  }
  const t = tokens(name), k = foldCo(name);
  if (t.length) {
    // shortened / extended: one side's tokens are a prefix-subset of the other
    for (const c of crrTokens) {
      if (!c.t.length) continue;
      const short = t.length <= c.t.length ? t : c.t;
      const long = t.length <= c.t.length ? c.t : t;
      if (short.length >= 2 && short.every((w, x) => long[x] === w) && short.length < long.length) {
        return { rung: "shortened", label: "Shortened or extended form of the same name", example: c.full };
      }
    }
  }
  let best: { d: number; full: string } | null = null;
  for (const c of crrTokens) {
    if (!c.k) continue;
    const d = levenshtein(k, c.k, 2);
    if (d <= 2 && (!best || d < best.d)) best = { d, full: c.full };
  }
  if (best) return { rung: "typo", label: "Spelling variant / typo on one side", example: best.full };
  return { rung: "absent", label: "Not present in the CRR file at all", example: "" };
}

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" as const, max: 1, prepare: false });

async function main() {
  const used: Row[] = (await sql.unsafe(
    `select party_name as name, count(*)::int as orders
       from ld_order_entry.customer_orders group by 1`)) as never;
  const drop: Row[] = (await sql.unsafe(
    `select value as name, 0 as orders
       from ld_order_entry.lookup_values where category='PARTY'`)) as never;

  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  say(`CRR file: ${crr.length} alias rows, ${new Set(crr.map((c) => c.id)).size} distinct customers`);
  say(`Ours:     ${drop.length} party dropdown values, ${used.length} names actually used on orders`);
  say();

  for (const [title, rows] of [
    ["OUR FULL PARTY LIST", drop],
    ["PARTY NAMES ACTUALLY USED ON ORDERS", used],
  ] as const) {
    const buckets = new Map<string, { n: number; orders: number; ex: string[] }>();
    for (const r of rows) {
      const c = classify(r.name);
      if (!buckets.has(c.rung)) buckets.set(c.rung, { n: 0, orders: 0, ex: [] });
      const b = buckets.get(c.rung)!;
      b.n++; b.orders += r.orders;
      if (b.ex.length < 5) b.ex.push(c.example ? `${r.name}  ~  ${c.example}` : r.name);
    }
    const order = [...LADDER.map((l) => l.key), "shortened", "typo", "absent"];
    const labels: Record<string, string> = Object.fromEntries([
      ...LADDER.map((l) => [l.key, l.label]),
      ["shortened", "Shortened or extended form of the same name"],
      ["typo", "Spelling variant / typo on one side"],
      ["absent", "Not present in the CRR file at all"],
    ]);
    const total = rows.length;
    say(`### ${title}  (${total} names)`);
    say();
    say("| Reason | Names | Share |");
    say("|---|---:|---:|");
    for (const k of order) {
      const b = buckets.get(k);
      if (!b) continue;
      say(`| ${labels[k]} | ${b.n} | ${((b.n / total) * 100).toFixed(1)}% |`);
    }
    say();
    for (const k of order) {
      const b = buckets.get(k);
      if (!b || k === "exact" || k === "scot") continue;
      say(`**${labels[k]}** — examples:`);
      for (const e of b.ex) say(`  - ${e}`);
      say();
    }
  }
  fs.writeFileSync("crr-matching-raw.txt", out.join("\n"), "utf8");
  await sql.end();
}
main();
