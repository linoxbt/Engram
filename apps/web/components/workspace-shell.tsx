"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { readConsent } from "@/lib/client/consent";
import { storageDown, useConflictCounts, useHealth } from "@/lib/client/workspace";
import {
  IconBolt, IconBook, IconChevron, IconCross, IconGrid, IconInbox, IconKey, IconLogo, IconMenu, IconPlug, IconPulse, IconSeal, IconShield, IconSidebar, IconUser, Wordmark,
} from "./icons";
import { useLayer } from "./ui";
import { VerifyBanner } from "./verify-banner";

export type NavItem = { href: string; label: string; icon: ComponentType<{ size?: number }>; exact?: boolean; badge?: number };

/** The space being viewed: its features fill the right-hand sidebar. */
export interface SpaceSection {
  key: string;
  name: string;
  nav: NavItem[];
  spaces: { key: string; name: string; sandbox: boolean }[];
  live: "realtime" | "polling";
}

const COLLAPSE_KEY = "engram.sidebar.mini";
const DESKTOP = "(min-width: 64rem)";
const watchDesktop = (cb: () => void) => { const m = window.matchMedia(DESKTOP); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
/** Sidebars are always on screen from `lg`; below it they are drawers. The server assumes desktop, so nothing is inert without JS. */
const useDesktop = () => useSyncExternalStore(watchDesktop, () => window.matchMedia(DESKTOP).matches, () => true);
const RIGHT_COLLAPSE_KEY = "engram.spacebar.mini";

/**
 * The app frame for every signed-in page. Workspace features live in the left sidebar; inside a space,
 * that space's own features get a second sidebar on the right. Each folds to an icon rail on desktop
 * and becomes a drawer under the app bar on phones. The logo always leads to the landing page.
 */
export function WorkspaceShell({ user, space, header, wide, children }: {
  user: { name: string; email: string; emailVerified?: boolean; guest?: boolean };
  space?: SpaceSection;
  header?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [mini, setMini] = useState(false);
  const [rightMini, setRightMini] = useState(false);
  const desktop = useDesktop();
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // The phone space drawer opens just below the space row, which moves with the verify banner and with scrolling.
  const [spaceTop, setSpaceTop] = useState<number | null>(null);
  useEffect(() => {
    if (!spaceMenu || desktop) return;
    const measure = () => { const el = headerRef.current; if (el) setSpaceTop(Math.max(0, el.getBoundingClientRect().bottom)); };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [spaceMenu, desktop]);
  const belowSpaceRow = !desktop && spaceTop != null ? { top: spaceTop } : undefined;
  // Phone drawers: focus moves in on open, Escape closes (only when no modal sits above), and closed ones are inert.
  useLayer(menu && !desktop, () => setMenu(false), leftRef, { trap: false, focus: "first" });
  useLayer(spaceMenu && !desktop, () => setSpaceMenu(false), rightRef, { trap: false, focus: "first" });
  const health = useHealth();
  const conflicts = useConflictCounts(!storageDown(health.data) && !!health.data);
  const openConflicts = Object.values(conflicts.data?.conflicts ?? {}).reduce<number>((n, c) => n + (c ?? 0), 0);

  useEffect(() => { setMenu(false); setSpaceMenu(false); }, [pathname]);
  useEffect(() => {
    try {
      setMini(localStorage.getItem(COLLAPSE_KEY) === "1");
      setRightMini(localStorage.getItem(RIGHT_COLLAPSE_KEY) === "1");
    } catch { /* storage blocked */ }
  }, []);
  // Layout preferences are kept only for visitors who accepted cookies and similar storage.
  const remember = (key: string, on: boolean) => { if (readConsent() !== "accepted") return; try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* storage blocked */ } };
  const toggleMini = () => setMini((m) => { remember(COLLAPSE_KEY, !m); return !m; });
  const toggleRightMini = () => setRightMini((m) => { remember(RIGHT_COLLAPSE_KEY, !m); return !m; });

  const sections: { title: string; items: NavItem[] }[] = [
    { title: "Workspace", items: [
      { href: "/app", label: "Spaces", icon: IconGrid, exact: true },
      { href: "/app/feed", label: "Activity", icon: IconPulse },
      { href: "/app/inbox", label: "Inbox", icon: IconInbox, badge: openConflicts || undefined },
      { href: "/app/integrity", label: "Integrity", icon: IconShield },
      { href: "/app/keys", label: "Agent keys", icon: IconKey },
    ] },
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
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const signOut = async () => {
    setSignOutError(null);
    try { await api("/api/auth/logout", { method: "POST" }); qc.clear(); router.push("/"); }
    catch (e) { setSignOutError(e instanceof Error ? e.message : String(e)); }
  };
  // Rails are desktop-only; the mobile drawers always show labels.
  const rail = mini && !menu;
  const rightRail = rightMini && !spaceMenu;

  return (
    <div className="flex min-h-screen">
      {/* Left: workspace features. */}
      <aside
        ref={leftRef}
        inert={!desktop && !menu}
        className={clsx(
          "fixed bottom-0 left-0 top-14 z-30 flex w-60 max-w-[78vw] flex-col border-r border-line bg-panel transition-[transform,width] duration-200 lg:top-0 lg:max-w-none lg:translate-x-0",
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
              <NavLinks items={sec.items} pathname={pathname} rail={rail} />
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-3 py-3 text-2xs text-muted">
          <Link href="/app/status" className={clsx("flex items-center gap-2 rounded-[2px] px-1 py-1 hover:text-text", rail && "lg:justify-center")} title={statusText}>
            <span className={clsx("size-2 shrink-0 rounded-full", statusTone)} />
            <span className={clsx("truncate", rail && "lg:hidden")}>{statusText}</span>
          </Link>
          <div className={clsx("mt-2 flex items-center gap-2 px-1", rail && "lg:flex-col")}>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold uppercase text-bg" title={user.email}>{user.name.slice(0, 1) || "?"}</span>
            <span className={clsx("min-w-0 flex-1 truncate text-text", rail && "lg:hidden")}>{user.name}</span>
            <button onClick={signOut} className={clsx("hover:text-text", rail && "lg:hidden")}>Sign out</button>
          </div>
          {signOutError && <p role="alert" className={clsx("mt-1 px-1 text-tamper", rail && "lg:hidden")}>Sign-out failed: {signOutError}</p>}
          {rail && (
            <button onClick={toggleMini} className="mt-2 hidden w-full place-items-center rounded-[2px] py-1 text-muted hover:bg-panel-2 hover:text-text lg:grid" aria-label="Expand sidebar" title="Expand sidebar">
              <IconChevron className="rotate-180" />
            </button>
          )}
        </div>
      </aside>

      {/* Right: the features of the space being viewed. */}
      {space && (
        <aside
          ref={rightRef}
          inert={!desktop && !spaceMenu}
          style={belowSpaceRow}
          className={clsx(
            // Phones: a drawer from the left, beneath the space header row. Desktop: the right-hand sidebar.
            "fixed bottom-0 left-0 top-[6.5rem] z-30 flex w-60 max-w-[78vw] flex-col border-r border-line bg-panel transition-[transform,width] duration-200 lg:left-auto lg:right-0 lg:top-0 lg:max-w-none lg:translate-x-0 lg:border-l lg:border-r-0",
            spaceMenu ? "translate-x-0" : "-translate-x-full",
            rightMini ? "lg:w-[60px]" : "lg:w-56",
          )}
          aria-label="Space navigation"
        >
          <div className={clsx("hidden h-14 items-center justify-between border-b border-line px-4 lg:flex", rightRail && "lg:justify-center lg:px-0")}>
            <span className={clsx("label", rightRail && "lg:hidden")}>This space</span>
            <button onClick={toggleRightMini} className="hidden size-7 place-items-center rounded-[2px] text-muted hover:bg-panel-2 hover:text-text lg:grid"
              aria-label={rightRail ? "Expand space sidebar" : "Collapse space sidebar"} title={rightRail ? "Expand space sidebar" : "Collapse space sidebar"}>
              <IconChevron className={rightRail ? undefined : "rotate-180"} />
            </button>
          </div>
          <div className={clsx("border-b border-line px-3 py-3", rightRail && "lg:hidden")}>
            <div className="mb-1.5 flex items-center justify-between lg:hidden">
              <span className="label">This space</span>
              <button onClick={() => setSpaceMenu(false)} className="grid size-7 place-items-center rounded-[2px] text-muted hover:bg-panel-2 hover:text-text" aria-label="Close space menu"><IconCross size={14} /></button>
            </div>
            <select value={space.key} onChange={(e) => router.push(`/app/${e.target.value}`)} aria-label="Switch space" className="h-8 w-full rounded-[2px] border border-line-2 bg-bg px-2 text-xs">
              {space.spaces.map((x) => <option key={x.key} value={x.key}>{x.name}{x.sandbox ? " (sandbox)" : ""}</option>)}
            </select>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            <NavLinks items={space.nav} pathname={pathname} rail={rightRail} />
          </nav>
          <div className="border-t border-line px-3 py-3 text-2xs text-muted">
            <div className={clsx("flex items-center gap-2 px-1 py-1", rightRail && "lg:justify-center")} title={space.live === "realtime" ? "Appwrite Realtime connected; pages still poll slowly in case the socket drops" : "Realtime is not connected: pages poll for changes (the feed every 3 seconds, conflicts every 10)"}>
              <span className={clsx("size-2 shrink-0 rounded-full", space.live === "realtime" ? "bg-valid" : "bg-warn")} />
              <span className={clsx("truncate", rightRail && "lg:hidden")}>{space.live === "realtime" ? "Realtime" : "Live (polling)"}</span>
            </div>
          </div>
        </aside>
      )}

      {(menu || spaceMenu) && <div className={clsx("fixed inset-x-0 bottom-0 z-20 bg-black/30 lg:hidden", spaceMenu ? "top-[6.5rem]" : "top-14")} style={spaceMenu ? belowSpaceRow : undefined} onClick={() => { setMenu(false); setSpaceMenu(false); }} />}
      <div className={clsx(
        "flex min-w-0 flex-1 flex-col transition-[padding] duration-200",
        mini ? "lg:pl-[60px]" : "lg:pl-60",
        space && (rightMini ? "lg:pr-[60px]" : "lg:pr-56"),
      )}>
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg px-4 lg:hidden">
          <Link href="/" aria-label="Engram home"><Wordmark size={22} /></Link>
          <button className="grid size-9 place-items-center rounded-[2px] border border-line text-text" onClick={() => { setSpaceMenu(false); setMenu((m) => !m); }}
            aria-label={menu ? "Close navigation" : "Open navigation"} aria-expanded={menu}>
            {menu ? <IconCross size={16} /> : <IconMenu size={16} />}
          </button>
        </header>
        {user.emailVerified === false && !user.guest && <VerifyBanner email={user.email} />}
        {header && (
          <div ref={headerRef} className="sticky top-14 z-10 border-b border-line bg-bg/90 backdrop-blur lg:top-0">{header}</div>
        )}
        <main className={clsx("mx-auto w-full flex-1 p-4", wide ? "max-w-[1400px] md:p-6" : "max-w-6xl md:p-8")}>
          {/* Phones: the space's pages open from this button, just below the space row. */}
          {space && (
            <button className={clsx("mb-4 inline-flex h-9 items-center gap-2 rounded-[2px] border px-3 text-xs lg:hidden", spaceMenu ? "border-accent bg-accent text-bg" : "border-line text-text")}
              onClick={() => { setMenu(false); setSpaceMenu((m) => !m); }} aria-expanded={spaceMenu}>
              {spaceMenu ? <IconCross size={16} /> : <IconSidebar size={16} />}
              {spaceMenu ? "Close space menu" : "Space menu"}
            </button>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLinks({ items, pathname, rail }: { items: NavItem[]; pathname: string; rail: boolean }) {
  return (
    <>
      {items.map((n) => {
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
    </>
  );
}
