"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type LiveMode = "realtime" | "polling";

/**
 * Live updates: Appwrite Realtime with a short-lived JWT when available,
 * otherwise polling every 3 seconds (the documented fallback).
 */
export function useLive(spaceKey: string): LiveMode {
  const qc = useQueryClient();
  const [mode, setMode] = useState<LiveMode>("polling");
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let refresh: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    async function connect() {
      try {
        const res = await fetch("/api/auth/jwt", { credentials: "same-origin" });
        if (!res.ok) return;
        const { jwt, endpoint, projectId, databaseId } = await res.json();
        if (!jwt || !endpoint || !projectId || cancelled) return;
        const { Client, Channel } = await import("appwrite");
        const client = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
        const channel = Channel.database(databaseId).collection("memories").document();
        unsub?.();
        unsub = client.subscribe(channel, (msg: { payload?: { metadata?: { space?: string } } }) => {
          if (msg.payload?.metadata?.space !== spaceKey) return;
          void qc.invalidateQueries({ queryKey: ["space", spaceKey] });
        });
        setMode("realtime");
      } catch {
        setMode("polling");
      }
    }
    void connect();
    refresh = setInterval(connect, 50 * 60_000);
    return () => { cancelled = true; unsub?.(); if (refresh) clearInterval(refresh); };
  }, [spaceKey, qc]);
  return mode;
}

export const pollInterval = (mode: LiveMode) => (mode === "polling" ? 3000 : false);
