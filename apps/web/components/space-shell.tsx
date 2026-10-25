"use client";
import Link from "next/link";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useSpaceInfo } from "@/lib/client/hooks";
import { useLive } from "@/lib/client/live";
import { staleBy } from "@/lib/client/report-copy";
import { finishSeeding, seedErrorReason, useSeedingActive, type SeedProgress } from "@/lib/client/seed";
import { IconAgents, IconAudit, IconChain, IconClock, IconGraph, IconHome, IconInbox, IconLab, IconList, IconSettings } from "./icons";
import { IntegrityBadge } from "./integrity-badge";
import { MemoryDrawer } from "./memory-drawer";
import { Button, Pill } from "./ui";
import { LiveCtx, OpenCtx, RoleCtx } from "./space-context";
import { WorkspaceShell, type NavItem, type SpaceSection } from "./workspace-shell";

export { useCanWrite, useLiveMode, useOpenMemory, useRole } from "./space-context";

export function SpaceShell({ spaceKey, user, children }: { spaceKey: string; user: { name: string; email: string; emailVerified?: boolean }; children: ReactNode }) {
  const info = useSpaceInfo(spaceKey);
  const live = useLive(spaceKey);
  const [opened, setOpened] = useState<{ space: string; id: string } | null>(null);
  const open = opened?.space === spaceKey ? opened.id : null;
  const spaces = useQuery({ queryKey: ["spaces"], queryFn: () => api<{ spaces: { key: string; name: string; sandbox: boolean }[] }>("/api/app/spaces") });
  const conflicts = useQuery({ queryKey: ["space", spaceKey, "conflicts"], queryFn: () => api<{ pairs: unknown[] }>(`/api/app/spaces/${spaceKey}/conflicts`), refetchInterval: live === "polling" ? 10_000 : false });
  // The newest entry, so the header badge can say when its stored result no longer covers the head.
  const head = useQuery({
    queryKey: ["space", spaceKey, "head"],
    queryFn: async () => { const r = await api<{ items: { seq: number }[] }>(`/api/app/spaces/${spaceKey}/feed?limit=1`); return r.items[0] ? r.items[0].seq + 1 : 0; },
    refetchInterval: live === "polling" ? 10_000 : 60_000, staleTime: 5_000,
  });
  const openMemory = useCallback((id: string) => setOpened({ space: spaceKey, id }), [spaceKey]);
  const s = info.data?.settings;
  const role = info.data?.role ?? null;
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
        {role === "viewer" && <Pill tone="accent" className="ml-2">read-only</Pill>}
        {s?.publicVerify && <Pill tone="gold" className="ml-2 hidden sm:inline-flex">public verify</Pill>}
      </div>
      <Link href={`${base}/chain`} className="min-w-0 max-w-[60%] shrink-0"><IntegrityBadge integrity={s?.integrity} checkpoint={s?.latestCheckpoint} stale={staleBy(s?.integrity, head.data)} /></Link>
    </div>
  );

  return (
    <OpenCtx.Provider value={openMemory}>
      <LiveCtx.Provider value={live}>
        <RoleCtx.Provider value={role}>
          {/* Next keeps a dynamic segment mounted when only its value changes, but page state (tabs, filters) is per space. */}
          <WorkspaceShell user={user} space={space} header={header} wide>
            <Fragment key={spaceKey}>
              {role === "viewer" && <ReadOnlyBanner />}
              {role === "owner" && s?.seeding && <SeedingBanner spaceKey={spaceKey} progress={{ done: s.seeding.next, total: s.seeding.total }} />}
              {children}
            </Fragment>
          </WorkspaceShell>
          <MemoryDrawer spaceKey={spaceKey} id={open} onClose={() => setOpened(null)} onNavigate={openMemory} />
        </RoleCtx.Provider>
      </LiveCtx.Provider>
    </OpenCtx.Provider>
  );
}

function ReadOnlyBanner() {
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[2px] border border-line-2 bg-panel px-4 py-2.5 text-xs">
      <Pill tone="accent">read-only</Pill>
      <span className="min-w-0 flex-1 text-muted">You are exploring the live demo as a guest. Browse, search, travel in time and verify every hash; writing is switched off. Guest access ends after 24 hours.</span>
      <Link href="/signup" className="text-accent underline-offset-2 hover:underline">Create your own space</Link>
    </div>
  );
}

/** A demo story that stopped part-way (a closed tab, a failed request) can be resumed from where the server recorded it. */
function SeedingBanner({ spaceKey, progress }: { spaceKey: string; progress: SeedProgress }) {
  const qc = useQueryClient();
  const running = useSeedingActive(spaceKey);
  const [live, setLive] = useState<SeedProgress | null>(null);
  const resume = useMutation({
    mutationFn: () => finishSeeding(spaceKey, { done: false, progress }, { onProgress: setLive }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["space", spaceKey] }),
  });
  const p = live ?? progress;
  const busy = running || resume.isPending;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[2px] border border-warn/50 bg-warn/5 px-4 py-2.5 text-xs">
      <span className="min-w-0 flex-1">
        <span className="text-warn">{busy ? `Writing the demo story… ${p.done}/${p.total}` : `The demo story stopped at ${p.done}/${p.total}.`}</span>
        {resume.error ? <span className="block text-tamper">It stopped again: {seedErrorReason(resume.error)}</span> : null}
        {!busy && !resume.error && <span className="block text-muted">The space works, but part of the story is missing. Resume continues from the last item the server recorded.</span>}
      </span>
      {!running && <Button size="sm" variant="outline" loading={resume.isPending} onClick={() => resume.mutate()}>{resume.error ? "Try again" : "Resume"}</Button>}
    </div>
  );
}

export { PageHeader } from "./ui";
