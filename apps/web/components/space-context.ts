"use client";
import { createContext, useContext } from "react";
import type { SpaceInfoResponse } from "@/lib/client/hooks";
import type { LiveMode } from "@/lib/client/live";

type Role = SpaceInfoResponse["role"];
export const OpenCtx = createContext<(id: string) => void>(() => {});
export const LiveCtx = createContext<LiveMode>("polling");
export const RoleCtx = createContext<Role | null>(null);
/** The read-only demo guest. Outside a space there is no role, so workspace screens gate on this instead. */
export const GuestCtx = createContext(false);
export const useOpenMemory = () => useContext(OpenCtx);
export const useLiveMode = () => useContext(LiveCtx);
/** The viewer's role in the current space; null while it loads (and outside a space). */
export const useRole = () => useContext(RoleCtx);
/** Read-only guests (role "viewer") see no write controls; nor does anyone until the role is known, so a guest never sees them flash. */
export const useCanWrite = () => { const r = useContext(RoleCtx); return r !== null && r !== "viewer"; };
/** True for the demo guest: every write it could start is refused with `read_only`, so no write control is offered. */
export const useIsGuest = () => useContext(GuestCtx);
