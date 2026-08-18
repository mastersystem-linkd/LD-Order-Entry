// Name matching against the CRR customer master.
//
// SCOT resolves our free-text party names to CRR customers using an alias table
// plus a canonicalising function. We mirror that logic so we can link an order
// to its CRR customer ourselves and hand SCOT the id directly.
//
// IMPORTANT: these functions are for MATCHING ONLY. Party names are stored and
// exported exactly as the operator typed them (SCOT's Rule 1) — a canonicalised
// string must never be written back over a name or sent on the wire.

/** Corporate suffixes SCOT strips. `CO`/`COMPANY` are deliberately absent: "JOHN & CO" must not collide with "JOHN". */
const SUFFIX =
  /\s+(PRIVATE LIMITED|PVT\.? ?LTD\.?|P\.? ?LTD\.?|LIMITED|LTD\.?|LLP|L\.L\.P\.|INCORPORATED|INC\.?|CORPORATION|CORP\.?)$/;

/**
 * SCOT's `scot_canon()`, reimplemented from their spec:
 * strip trailing bracket groups repeatedly, strip trailing dots/space,
 * collapse whitespace + uppercase, then strip ONE trailing corporate suffix.
 */
export function crrCanon(raw: string): string {
  let s = raw;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/(\s*\([^()]*\)\s*)+$/, "");
  } while (s !== prev);
  s = s.replace(/[.\s]+$/, "").replace(/\s+/g, " ").trim().toUpperCase();
  return s.replace(SUFFIX, "").trim();
}

/**
 * A looser key than `crrCanon`. On top of it, folds away internal punctuation
 * and spacing and trailing plurals — the two differences that account for most
 * of our misses (we write "R. K. FASHION", CRR has "R.K.FASHION"; we write
 * "A R GARMENT", CRR has "A.R.GARMENTS"). Also treats COMPANY as CO.
 *
 * Safe to match on: no two real companies in the file differ only by internal
 * spacing or a plural. NOT safe to derive display text from.
 */
export function crrTight(raw: string): string {
  return crrCanon(raw)
    .replace(/\bCOMPANY\b/g, "CO")
    .replace(SUFFIX, "")
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 2 ? w.replace(/S$/, "") : w))
    .join("");
}

/** Presentation tidy-up only: trailing dots/space removed, inner runs collapsed. Never changes spelling or case. */
export function tidyDisplayName(raw: string): string {
  return raw.replace(/[.\s]+$/, "").replace(/\s+/g, " ").trim();
}

/** How a name was linked to a CRR customer. Confidence descends down the list. */
export type CrrMatchMethod = "exact" | "canon" | "tight";

export const MATCH_METHOD_LABEL: Record<CrrMatchMethod, string> = {
  exact: "Exact CRR spelling",
  canon: "Matched after ignoring dots, brackets and Ltd/Pvt Ltd",
  tight: "Matched after also ignoring spacing and plural s",
};
