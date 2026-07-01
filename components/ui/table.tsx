import * as React from "react";

import { cn } from "@/lib/utils";

// Canonical data-table primitives. One definition for every table in the app so
// headers never drift apart. The header *appearance* lives on <Th> (not on
// <thead>) so it stays identical even inside sticky / custom thead wrappers.
//
// House header style (matches the Operations table): uppercase, 13px, bold,
// tracking-[0.04em], text-ink, never wraps.

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full text-left text-sm text-ink", className)}
      {...props}
    />
  );
}

// Header row container: just the bottom rule. Pass extra classes (e.g. sticky
// positioning) via className.
export function THead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-line", className)} {...props} />;
}

// THE canonical column header. Numeric columns pass `text-right`; a flexible
// free-text column can pass `w-full`.
export function Th({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-left align-middle text-[13px] font-bold uppercase tracking-[0.04em] whitespace-nowrap text-ink",
        className,
      )}
      {...props}
    />
  );
}

// Standard body cell. whitespace-nowrap by default; free-text columns that
// should wrap pass `whitespace-normal`.
export function Td({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-3 py-2 align-middle whitespace-nowrap", className)}
      {...props}
    />
  );
}
