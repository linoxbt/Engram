"use client";
import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";

export interface SeedProgress { done: number; total: number }
export interface SeedState { done: boolean; progress: SeedProgress | null }

/** Seeding stopped before the story was complete. The space exists and the server remembers where it stopped. */
export class SeedIncomplete extends Error {
  constructor(public space: string, public progress: SeedProgress | null, public cause: unknown) {
    super(`Seeding stopped${progress ? ` at ${progress.done}/${progress.total}` : ""}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** The reason a seeding run stopped, without repeating the progress the caller already shows. */
export function seedErrorReason(e: unknown): string {
  const cause = e instanceof SeedIncomplete ? e.cause : e;
  return cause instanceof Error ? cause.message : String(cause);
}

/** Network failures, timeouts, rate limits and server errors are worth retrying; a refusal (403, 404, 400) is not. */
export function retryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500 || e.code === "bad_response";
}

// Spaces with a seeding loop running in this tab, so a banner and a button never drive the same story twice.
const active = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const isSeeding = (space: string) => active.has(space);
export const useSeedingActive = (space: string) => useSyncExternalStore(subscribe, () => active.has(space), () => false);

export interface SeedOptions {
  onProgress?: (p: SeedProgress) => void;
  /** Attempts per slice before giving up (default 5: waits 1, 2, 4 and 8 seconds between them). */
  attempts?: number;
  /** Slices that may pass without the story moving forward before the run counts as stuck. */
  stallLimit?: number;
  /** Upper bound on slices, far above any story's length. */
  maxSlices?: number;
  sleep?: (ms: number) => Promise<void>;
  post?: (space: string) => Promise<SeedState>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const postSlice = (space: string) => api<SeedState>(`/api/app/spaces/${space}/seed`, { method: "POST" });

/**
 * Keep asking the server to write the next slice of a demo story until it is complete. Each slice is retried with
 * exponential backoff; the server records progress after every item, so a later call resumes where this one
 * stopped. Never returns silently unfinished: if the story cannot be completed it throws SeedIncomplete.
 */
export async function finishSeeding(space: string, first: SeedState | null, opts: SeedOptions = {}): Promise<SeedProgress | null> {
  const { onProgress, attempts = 5, stallLimit = 6, maxSlices = 500, sleep = wait, post = postSlice } = opts;
  if (!first) return null; // nothing was started
  if (first.done) { if (first.progress) onProgress?.(first.progress); return first.progress; }
  if (active.has(space)) throw new SeedIncomplete(space, first?.progress ?? null, new Error("seeding is already running in this tab"));
  active.add(space); emit();
  let s = first;
  let progress = first?.progress ?? null;
  try {
    if (progress) onProgress?.(progress);
    let stalled = 0;
    for (let slice = 0; !s.done; slice++) {
      if (slice >= maxSlices) throw new SeedIncomplete(space, progress, new Error(`the story was not finished after ${maxSlices} requests`));
      let next: SeedState | null = null;
      for (let attempt = 1; ; attempt++) {
        try { next = await post(space); break; } catch (e) {
          if (attempt >= attempts || !retryable(e)) throw new SeedIncomplete(space, progress, e);
          await sleep(1000 * 2 ** (attempt - 1));
        }
      }
      const before = progress?.done ?? -1;
      s = next ?? { done: true, progress };
      if (s.progress) { progress = s.progress; onProgress?.(progress); }
      if (!s.done) {
        stalled = (progress?.done ?? -1) > before ? 0 : stalled + 1;
        if (stalled >= stallLimit) throw new SeedIncomplete(space, progress, new Error("the server stopped making progress"));
      }
    }
    return progress;
  } finally {
    active.delete(space); emit();
  }
}
