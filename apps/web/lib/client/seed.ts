"use client";
import { api } from "./api";

export interface SeedState { done: boolean; progress: { done: number; total: number } | null }

/** Keep calling the server until a demo story is fully written; each request writes one short slice. */
export async function finishSeeding(space: string, first: SeedState | null, onProgress?: (p: { done: number; total: number }) => void) {
  let s = first;
  for (let guard = 0; s && !s.done && guard < 200; guard++) {
    if (s.progress) onProgress?.(s.progress);
    s = await api<SeedState>(`/api/app/spaces/${space}/seed`, { method: "POST" });
  }
  if (s?.progress) onProgress?.(s.progress);
}
