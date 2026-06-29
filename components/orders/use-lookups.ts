"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api-client";

export type LookupCategory =
  | "PARTY"
  | "SALES_PERSON"
  | "AGENT"
  | "HASTE"
  | "TRANSPORT"
  | "FABRIC";

// Autocomplete sources (CLAUDE.md §4). Cached for the session; suggestions only.
export function useLookup(category: LookupCategory) {
  return useQuery({
    queryKey: ["lookups", category],
    queryFn: () => apiGet<string[]>(`/api/lookups?category=${category}`),
    staleTime: 5 * 60_000,
  });
}

// Distinct design numbers from the Design Database (CLAUDE.md §4), scoped to a
// fabric when given. Queries share a cache key per fabric so multiple design
// rows in one block don't refetch.
export function useDesigns(fabric?: string) {
  const f = fabric?.trim() ?? "";
  return useQuery({
    queryKey: ["designs", f],
    queryFn: () =>
      apiGet<string[]>(`/api/designs${f ? `?fabric=${encodeURIComponent(f)}` : ""}`),
    staleTime: 5 * 60_000,
  });
}
