"use client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, readJson } from "./api";
import type { Integrity } from "@/components/integrity-badge";

export interface SpaceRow {
  key: string; name: string; description: string; sandbox: boolean; publicVerify: boolean;
  integrity: Integrity | null; latestCheckpoint: { size: number; createdAt: string } | null; createdAt: string; owner: boolean;
}

export interface Health {
  ok: boolean; backend: string; error?: string;
  database?: { ok: boolean; ms: number; error?: string };
  embeddings?: { ok: boolean; ms: number; error?: string };
  storage?: { ok: boolean; ms: number; error?: string };
  signing?: { checkpointFunction: boolean; inlineKey: boolean; publicKey: boolean };
  classifier?: string;
  classifierCheck?: { ok: boolean; ms: number; error?: string } | null;
}

export const useSpaces = () => useQuery({ queryKey: ["spaces"], queryFn: () => api<{ spaces: SpaceRow[] }>("/api/app/spaces") });

export const useHealth = () => useQuery({
  queryKey: ["health"],
  queryFn: () => fetch("/api/v1/health?fresh=1").then((r) => readJson<Health>(r)),
  staleTime: 30_000,
});

/** Open conflict pairs per space key (null where a space could not be read), for the Inbox badge. */
export const useConflictCounts = (enabled = true) => useQuery({
  queryKey: ["conflicts", "counts"],
  queryFn: () => api<{ conflicts: Record<string, number | null> }>("/api/app/conflicts"),
  enabled,
  staleTime: 30_000,
});

/** Memory storage is unavailable: per-space data calls would only fail, so pages skip them. */
export const storageDown = (h: Health | undefined) => !!h?.database && !h.database.ok;

/**
 * Runs one query per space with the same key the space pages use, so the caches are shared.
 * Results keep the space beside the data; failures stay per space instead of failing the page.
 */
export function useEachSpace<T>(spaces: SpaceRow[] | undefined, part: string, path: (key: string) => string, enabled = true) {
  const results = useQueries({
    queries: (spaces ?? []).map((s) => ({
      queryKey: ["space", s.key, part],
      queryFn: () => api<T>(path(s.key)),
      enabled,
      retry: 1,
    })),
  });
  return {
    loading: results.some((r) => r.isLoading),
    rows: (spaces ?? []).map((space, i) => ({ space, data: results[i]?.data as T | undefined, error: results[i]?.error ?? null })),
  };
}
