"use client";
import { createContext, useContext } from "react";
import type { SpaceInfoResponse } from "@/lib/client/hooks";
import type { LiveMode } from "@/lib/client/live";

type Role = SpaceInfoResponse["role"];
export const OpenCtx = createContext<(id: string) => void>(() => {});
export const LiveCtx = createContext<LiveMode>("polling");
export const RoleCtx = createContext<Role | null>(null);
export const useOpenMemory = () => useContext(OpenCtx);
export const useLiveMode = () => useContext(LiveCtx);
/** The viewer's role in the current space; null while it loads (and outside a space). */
export const useRole = () => useContext(RoleCtx);
/** Read-only guests (role "viewer") see no write controls; nor does anyone until the role is known, so a guest never sees them flash. */
export const useCanWrite = () => { const r = useContext(RoleCtx); return r !== null && r !== "viewer"; };
