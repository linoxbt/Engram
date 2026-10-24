"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { storageDown, useEachSpace, useHealth, useSpaces } from "@/lib/client/workspace";
import {
  IconBolt, IconBook, IconChevron, IconCross, IconGrid, IconInbox, IconKey, IconLogo, IconMenu, IconPlug, IconPulse, IconSeal, IconShield, IconUser, Wordmark,
} from "./icons";

export type NavItem = { href: string; label: string; icon: ComponentType<{ size?: number }>; exact?: boolean; badge?: number };

/** The space being viewed: its pages join the sidebar beneath the workspace features. */
export interface SpaceSection {
  key: string;
  name: string;
  nav: NavItem[];
  spaces: { key: string; name: string; sandbox: boolean }[];
  live: "realtime" | "polling";
}

const COLLAPSE_KEY = "engram.sidebar.mini";

/**
 * The app frame for every signed-in page: one left sidebar (workspace features, the current space's
 * pages when inside one, build and system links) that folds to an icon rail on desktop and opens
 * beneath the app bar on phones. The logo always leads to the landing page.
 */
export function WorkspaceShell({ user, space, header, wide, children }: {
  user: { name: string; email: string };
  space?: SpaceSection;
  header?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [mini, setMini] = useState(false);
  const health = useHealth();
  const spaces = useSpaces();
  const conflicts = useEachSpace<{ pairs: unknown[] }>(spaces.data?.spaces, "conflicts", (k) => `/api/app/spaces/${k}/conflicts`, !storageDown(health.data) && !!health.data);
  const openConflicts = conflicts.rows.reduce((n, r) => n + (r.data?.pairs.length ?? 0), 0);

  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => { try { setMini(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* storage blocked */ } }, []);
  const toggleMini = () => setMini((m) => { try { localStorage.setItem(COLLAPSE_KEY, m ? "0" : "1"); } catch { /* storage blocked */ } return !m; });

  const sections: { title: string; items: NavItem[]; space?: SpaceSection }[] = [
    { title: "Workspace", items: [
      { href: "/app", label: "Spaces", icon: IconGrid, exact: true },
      { href: "/app/feed", label: "Activity", icon: IconPulse },
      { href: "/app/inbox", label: "Inbox", icon: IconInbox, badge: openConflicts || undefined },
      { href: "/app/integrity", label: "Integrity", icon: IconShield },
      { href: "/app/keys", label: "Agent keys", icon: IconKey },
    ] },
    ...(space ? [{ title: "This space", items: space.nav, space }] : []),
    { title: "Build", items: [
      { href: "/app/connect", label: "Connect an agent", icon: IconPlug },
      { href: "/docs", label: "Docs", icon: IconBook },
      { href: "/verify", label: "Public verifier", icon: IconSeal },
    ] },
    { title: "System", items: [
      { href: "/app/status", label: "Status", icon: IconBolt },
      { href: "/app/account", label: "Account", icon: IconUser },
    ] },
  ];
  const statusTone = !health.data ? "bg-line-2" : health.data.ok ? "bg-valid" : storageDown(health.data) ? "bg-warn" : "bg-tamper";
  const statusText = !health.data ? "Checking…" : health.data.ok ? "All systems normal" : storageDown(health.data) ? "Memory storage pending" : "Degraded";
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }); qc.clear(); router.push("/"); };
  // The rail is desktop-only; the mobile drawer always shows labels.
  const rail = mini && !menu;

  return (
    <div className="flex min-h-screen">
      <aside
        className={clsx(
          "fixed bottom-0 left-0 top-14 z-30 flex w-72 max-w-[85vw] flex-col border-r border-line bg-panel transition-[transform,width] duration-200 lg:top-0 lg:max-w-none lg:translate-x-0",
          menu ? "translate-x-0" : "-translate-x-full",
          mini ? "lg:w-[60px]" : "lg:w-60",
        )}
        aria-label="Workspace navigation"
      >
        <div className={clsx("hidden h-14 items-center justify-between border-b border-line px-4 lg:flex", rail && "lg:justify-center lg:px-0")}>
          <Link href="/" aria-label="Engram home" className={clsx(rail && "lg:hidden")}><Wordmark size={22} /></Link>
          {rail && <Link href="/" aria-label="Engram home" className="hidden lg:block"><IconLogo size={26} /></Link>}
          <button onClick={toggleMini} className={clsx("hidden size-7 place-items-center rounded-[2px] text-muted hover:bg-panel-2 hover:text-text lg:grid", rail && "lg:hidden")} aria-label="Collapse sidebar" title="Collapse sidebar">
            <IconChevron />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {sections.map((sec) => (
            <div key={sec.title} className="mb-4">
              <div className={clsx("label mb-1.5 px-2.5", rail && "lg:sr-only")}>{sec.title}</div>
              {sec.space && (
                <select value={sec.space.key} onChange={(e) => router.push(`/app/${e.target.value}`)} aria-label="Switch space"
                  className={clsx("mx-2.5 mb-2 h-8 w-[calc(100%-1.25rem)] rounded-[2px] border border-line-2 bg-bg px-2 text-xs", rail && "lg:hidden")}>
                  {sec.space.spaces.map((x) => <option key={x.key} value={x.key}>{x.name}{x.sandbox ? " (sandbox)" : ""}</option>)}
                </select>
              )}
              {sec.items.map((n) => {
                const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
                return (
                  <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} title={rail ? n.label : undefined}
                    className={clsx(
                      "relative mb-0.5 flex items-center gap-2.5 rounded-[2px] px-2.5 py-2 text-xs transition-colors",
                      rail && "lg:justify-center lg:px-0",
                      active ? "bg-accent text-bg" : "text-muted hover:bg-panel-2 hover:text-text",
                    )}>
                    <n.icon size={15} />
                    <span className={clsx("flex-1 truncate", rail && "lg:hidden")}>{n.label}</span>
                    {n.badge ? (
                      <span className={clsx("rounded-[2px] px-1.5 text-2xs tabular", active ? "bg-bg/20 text-bg" : "bg-tamper/15 text-tamper", rail && "lg:absolute lg:right-1 lg:top-0.5 lg:px-1")}>{n.badge}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-3 py-3 text-2xs text-muted">
          <Link href="/app/status" className={clsx("flex items-center gap-2 rounded-[2px] px-1 py-1 hover:text-text", rail && "lg:justify-center")} title={statusText}>
            <span className={clsx("size-2 shrink-0 rounded-full", statusTone)} />
            <span className={clsx("truncate", rail && "lg:hidden")}>{statusText}</span>
          </Link>
          {space && (
            <div className={clsx("flex items-center gap-2 px-1 py-1", rail && "lg:justify-center")} title={space.live === "realtime" ? "Appwrite Realtime connected" : "Polling every 3 seconds"}>
              <span className={clsx("size-2 shrink-0 rounded-full", space.live === "realtime" ? "bg-valid" : "bg-warn")} />
              <span className={clsx("truncate", rail && "lg:hidden")}>{space.live === "realtime" ? "Realtime" : "Live (polling)"}</span>
            </div>
          )}
          <div className={clsx("mt-2 flex items-center gap-2 px-1", rail && "lg:flex-col")}>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold uppercase text-bg" title={user.email}>{user.name.slice(0, 1) || "?"}</span>
            <span className={clsx("min-w-0 flex-1 truncate text-text", rail && "lg:hidden")}>{user.name}</span>
            <button onClick={signOut} className={clsx("hover:text-text", rail && "lg:hidden")}>Sign out</button>
          </div>
          {rail && (
            <button onClick={toggleMini} className="mt-2 hidden w-full place-items-center rounded-[2px] py-1 text-muted hover:bg-panel-2 hover:text-text lg:grid" aria-label="Expand sidebar" title="Expand sidebar">
              <IconChevron className="rotate-180" />
            </button>
          )}
        </div>
      </aside>
      {menu && <div className="fixed inset-x-0 bottom-0 top-14 z-20 bg-black/30 lg:hidden" onClick={() => setMenu(false)} />}
      <div className={clsx("flex min-w-0 flex-1 flex-col transition-[padding] duration-200", mini ? "lg:pl-[60px]" : "lg:pl-60")}>
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg px-4 lg:hidden">
          <Link href="/" aria-label="Engram home"><Wordmark size={22} /></Link>
          <button className="grid size-9 place-items-center rounded-[2px] border border-line text-text" onClick={() => setMenu((m) => !m)}
            aria-label={menu ? "Close navigation" : "Open navigation"} aria-expanded={menu}>
            {menu ? <IconCross size={16} /> : <IconMenu size={16} />}
          </button>
        </header>
        {header && <div className="sticky top-14 z-10 border-b border-line bg-bg/90 backdrop-blur lg:top-0">{header}</div>}
        <main className={clsx("mx-auto w-full flex-1 p-4", wide ? "max-w-[1400px] md:p-6" : "max-w-6xl md:p-8")}>{children}</main>
      </div>
    </div>
  );
}
