"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readJson } from "./api";

export type LiveMode = "realtime" | "polling";

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
      try {
        const res = await fetch("/api/auth/jwt", { credentials: "same-origin" });
        if (!res.ok) return;
        const { jwt, endpoint, projectId, databaseId } = (await readJson<{ jwt?: string; endpoint?: string; projectId?: string; databaseId?: string } | null>(res)) ?? {};
        if (!jwt || !endpoint || !projectId || !databaseId || cancelled) return;
        const { Client, Channel } = await import("appwrite");
        if (cancelled) return;
        const client = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
        const channel = Channel.database(databaseId).collection("memories").document();
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
    void connect();
    // The JWT lives 15 minutes (it only opens the socket); reconnect with a fresh one before it lapses.
    const refresh = setInterval(connect, 12 * 60_000);
    return () => { cancelled = true; unsub?.(); clearInterval(refresh); if (debounce) clearTimeout(debounce); };
  }, [spaceKey, qc]);
  return mode;
}

/** Realtime still keeps a slow poll, in case the socket drops silently. */
export const pollInterval = (mode: LiveMode) => (mode === "polling" ? 3000 : 30_000);
