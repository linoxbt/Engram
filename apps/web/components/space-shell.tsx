"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useSpaceInfo } from "@/lib/client/hooks";
import { useLive, type LiveMode } from "@/lib/client/live";
import {
  IconAgents, IconAudit, IconChain, IconClock, IconGraph, IconHome, IconInbox, IconLab, IconList, IconLogo, IconMenu, IconSettings,
} from "./icons";
import { IntegrityBadge } from "./integrity-badge";
import { MemoryDrawer } from "./memory-drawer";
import { Pill } from "./ui";

const OpenCtx = createContext<(id: string) => void>(() => {});
const LiveCtx = createContext<LiveMode>("polling");
export const useOpenMemory = () => useContext(OpenCtx);
export const useLiveMode = () => useContext(LiveCtx);

export function SpaceShell({ spaceKey, children }: { spaceKey: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const info = useSpaceInfo(spaceKey);
  const live = useLive(spaceKey);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const spaces = useQuery({ queryKey: ["spaces"], queryFn: () => api<{ spaces: { key: string; name: string; sandbox: boolean }[] }>("/api/app/spaces") });
  const conflicts = useQuery({ queryKey: ["space", spaceKey, "conflicts"], queryFn: () => api<{ pairs: unknown[] }>(`/api/app/spaces/${spaceKey}/conflicts`), refetchInterval: live === "polling" ? 10_000 : false });
  useEffect(() => setMenu(false), [pathname]);
  const openMemory = useCallback((id: string) => setOpen(id), []);
  const s = info.data?.settings;
  const base = `/app/${spaceKey}`;
  const nav = [
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
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }); qc.clear(); router.push("/"); };

  return (
    <OpenCtx.Provider value={openMemory}>
      <LiveCtx.Provider value={live}>
        <div className="flex min-h-screen">
          <aside className={clsx("fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-line bg-panel transition-transform lg:translate-x-0", menu ? "translate-x-0" : "-translate-x-full")}>
            <Link href="/app" className="flex items-center gap-2 border-b border-line px-4 py-3.5">
              <IconLogo /> <span className="font-semibold tracking-wide">ENGRAM</span>
            </Link>
            <div className="border-b border-line px-3 py-3">
              <label className="label mb-1 block" htmlFor="space-switch">Space</label>
              <select id="space-switch" value={spaceKey} onChange={(e) => router.push(`/app/${e.target.value}`)} className="h-8 w-full rounded-[2px] border border-line-2 bg-bg px-2 text-xs">
                {(spaces.data?.spaces ?? [{ key: spaceKey, name: s?.name ?? spaceKey, sandbox: false }]).map((x) => <option key={x.key} value={x.key}>{x.name}{x.sandbox ? " (sandbox)" : ""}</option>)}
              </select>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Space">
              {nav.map((n) => {
                const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
                return (
                  <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                    className={clsx("mb-0.5 flex items-center gap-2.5 rounded-[2px] px-2.5 py-2 text-xs", active ? "bg-panel-2 text-accent" : "text-muted hover:bg-panel-2 hover:text-text")}>
                    <n.icon /> <span className="flex-1">{n.label}</span>
                    {n.badge ? <span className="rounded-[2px] bg-tamper/20 px-1.5 text-2xs text-tamper">{n.badge}</span> : null}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-line px-4 py-3 text-2xs text-muted">
              <div className="flex items-center gap-1.5" title={live === "realtime" ? "Appwrite Realtime connected" : "Polling every 3 seconds"}>
                <span className={clsx("size-1.5 rounded-full", live === "realtime" ? "bg-valid" : "bg-warn")} />
                {live === "realtime" ? "Realtime" : "Live (polling)"}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="truncate">{info.data?.user.name}</span>
                <button onClick={signOut} className="hover:text-text">Sign out</button>
              </div>
            </div>
          </aside>
          {menu && <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setMenu(false)} />}
          <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
            <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur">
              <button className="text-muted lg:hidden" onClick={() => setMenu(true)} aria-label="Open navigation"><IconMenu size={18} /></button>
              <div className="min-w-0 flex-1 truncate text-sm">
                <span className="text-text">{s?.name ?? "…"}</span>
                <span className="ml-2 text-2xs text-muted tabular">{spaceKey}</span>
                {s?.sandbox && <Pill tone="warning" className="ml-2">sandbox</Pill>}
                {s?.publicVerify && <Pill tone="gold" className="ml-2 hidden sm:inline-flex">public verify</Pill>}
              </div>
              <Link href={`${base}/chain`}><IntegrityBadge integrity={s?.integrity} checkpoint={s?.latestCheckpoint} /></Link>
            </header>
            <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">{children}</main>
          </div>
        </div>
        <MemoryDrawer spaceKey={spaceKey} id={open} onClose={() => setOpen(null)} onNavigate={setOpen} />
      </LiveCtx.Provider>
    </OpenCtx.Provider>
  );
}

export function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-lg tracking-wide">{title}</h1>
        {children && <p className="mt-1 max-w-3xl text-xs text-muted">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
