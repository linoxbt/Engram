"use client";
import Link from "next/link";
import { createContext, Fragment, useCallback, useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useSpaceInfo } from "@/lib/client/hooks";
import { useLive, type LiveMode } from "@/lib/client/live";
import { IconAgents, IconAudit, IconChain, IconClock, IconGraph, IconHome, IconInbox, IconLab, IconList, IconSettings } from "./icons";
import { IntegrityBadge } from "./integrity-badge";
import { MemoryDrawer } from "./memory-drawer";
import { Pill } from "./ui";
import { WorkspaceShell, type NavItem, type SpaceSection } from "./workspace-shell";

const OpenCtx = createContext<(id: string) => void>(() => {});
const LiveCtx = createContext<LiveMode>("polling");
export const useOpenMemory = () => useContext(OpenCtx);
export const useLiveMode = () => useContext(LiveCtx);

export function SpaceShell({ spaceKey, user, children }: { spaceKey: string; user: { name: string; email: string; emailVerified?: boolean }; children: ReactNode }) {
  const info = useSpaceInfo(spaceKey);
  const live = useLive(spaceKey);
  const [opened, setOpened] = useState<{ space: string; id: string } | null>(null);
  const open = opened?.space === spaceKey ? opened.id : null;
  const spaces = useQuery({ queryKey: ["spaces"], queryFn: () => api<{ spaces: { key: string; name: string; sandbox: boolean }[] }>("/api/app/spaces") });
  const conflicts = useQuery({ queryKey: ["space", spaceKey, "conflicts"], queryFn: () => api<{ pairs: unknown[] }>(`/api/app/spaces/${spaceKey}/conflicts`), refetchInterval: live === "polling" ? 10_000 : false });
  const openMemory = useCallback((id: string) => setOpened({ space: spaceKey, id }), [spaceKey]);
  const s = info.data?.settings;
  const base = `/app/${spaceKey}`;
  const nav: NavItem[] = [
    { href: base, label: "Overview", icon: IconHome, exact: true },
    { href: `${base}/memories`, label: "Memories", icon: IconList },
    { href: `${base}/chain`, label: "Chain & verifier", icon: IconChain },
    { href: `${base}/time`, label: "Time Machine", icon: IconClock },
    { href: `${base}/conflicts`, label: "Conflicts", icon: IconInbox, badge: conflicts.data?.pairs.length || undefined },
    { href: `${base}/concepts`, label: "Concept map", icon: IconGraph },
    { href: `${base}/agents`, label: "Agents", icon: IconAgents },
    { href: `${base}/recalls`, label: "Recall audit", icon: IconAudit },
    ...(s?.sandbox ? [{ href: `${base}/lab`, label: "Tamper Lab", icon: IconLab }] : []),
    { href: `${base}/settings`, label: "Settings", icon: IconSettings },
  ];
  const space: SpaceSection = {
    key: spaceKey,
    name: s?.name ?? spaceKey,
    nav,
    spaces: spaces.data?.spaces ?? [{ key: spaceKey, name: s?.name ?? spaceKey, sandbox: !!s?.sandbox }],
    live,
  };
  const header = (
    <div className="flex h-12 items-center gap-3 px-4">
      <div className="min-w-0 flex-1 truncate text-sm">
        <span className="text-text">{s?.name ?? "…"}</span>
        <span className="ml-2 text-2xs text-muted tabular">{spaceKey}</span>
        {s?.sandbox && <Pill tone="warning" className="ml-2">sandbox</Pill>}
        {s?.publicVerify && <Pill tone="gold" className="ml-2 hidden sm:inline-flex">public verify</Pill>}
      </div>
      <Link href={`${base}/chain`}><IntegrityBadge integrity={s?.integrity} checkpoint={s?.latestCheckpoint} /></Link>
    </div>
  );

  return (
    <OpenCtx.Provider value={openMemory}>
      <LiveCtx.Provider value={live}>
        {/* Next keeps a dynamic segment mounted when only its value changes, but page state (tabs, filters) is per space. */}
        <WorkspaceShell user={user} space={space} header={header} wide><Fragment key={spaceKey}>{children}</Fragment></WorkspaceShell>
        <MemoryDrawer spaceKey={spaceKey} id={open} onClose={() => setOpened(null)} onNavigate={openMemory} />
      </LiveCtx.Provider>
    </OpenCtx.Provider>
  );
}

export { PageHeader } from "./ui";
