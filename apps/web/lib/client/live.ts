"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readJson } from "./api";
import { readConsent } from "./consent";

export type LiveMode = "realtime" | "polling";

/** Fixed at build time: Realtime needs the browser SDK's endpoint and project. */
const REALTIME_CONFIGURED = !!process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT && !!process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;

/**
 * Live updates: Appwrite Realtime with a short-lived JWT when available, otherwise polling every 3 seconds
 * (the documented fallback). Realtime counts as connected only once an event arrives; until then polling stays on.
 * Bursts of events coalesce into one invalidation per space after 500ms.
 */
export function useLive(spaceKey: string): LiveMode {
  const qc = useQueryClient();
  const [mode, setMode] = useState<LiveMode>("polling");
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    setMode("polling");
    const invalidate = () => {
      if (debounce) return;
      debounce = setTimeout(() => { debounce = null; void qc.invalidateQueries({ queryKey: ["space", spaceKey] }); }, 500);
    };
    async function connect() {
      // No Realtime on this deployment (the local backend) or no cookie consent: never ask for a JWT, just poll.
      if (!REALTIME_CONFIGURED || readConsent() !== "accepted") return;
      try {
        const res = await fetch("/api/auth/jwt", { credentials: "same-origin" });
        if (!res.ok) return;
        const { jwt, endpoint, projectId, databaseId } = (await readJson<{ jwt?: string; endpoint?: string; projectId?: string; databaseId?: string } | null>(res)) ?? {};
        if (!jwt || !endpoint || !projectId || !databaseId || cancelled) return;
        const { Client, Channel } = await import("appwrite");
        if (cancelled) return;
        const client = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
        // Verified live (docs/verified.md, events): VectorsDB documents publish on "vectorsdb.<db>...", not "databases.<db>...".
        const channel = Channel.database(databaseId).collection("memories").document().toString().replace(/^databases\./, "vectorsdb.");
        unsub?.();
        unsub = client.subscribe(channel, (msg: { payload?: { metadata?: { space?: string } } }) => {
          if (cancelled) return;
          setMode("realtime");
          if (msg.payload?.metadata?.space === spaceKey) invalidate();
        });
      } catch {
        setMode("polling");
      }
    }
    // Connect after the page's first data requests, so the JWT round trip does not slow the first paint.
    const start = setTimeout(() => void connect(), 2500);
    // The JWT lives 15 minutes (it only opens the socket); reconnect with a fresh one before it lapses.
    const refresh = setInterval(connect, 12 * 60_000);
    return () => { cancelled = true; unsub?.(); clearTimeout(start); clearInterval(refresh); if (debounce) clearTimeout(debounce); };
  }, [spaceKey, qc]);
  return mode;
}

/** Realtime still keeps a slow poll, in case the socket drops silently. */
export const pollInterval = (mode: LiveMode) => (mode === "polling" ? 3000 : 30_000);
