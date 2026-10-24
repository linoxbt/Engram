import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Docs" };

const NAV = [
  { href: "/docs", label: "Quickstart" },
  { href: "/docs/concepts", label: "Concepts" },
  { href: "/docs/mcp", label: "MCP setup" },
  { href: "/docs/api", label: "REST API" },
  { href: "/docs/deploy", label: "Deploy & operate" },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8">
        <nav className="hidden w-44 shrink-0 md:block" aria-label="Docs">
          <ul className="sticky top-20 space-y-1 text-xs">
            {NAV.map((n) => <li key={n.href}><Link href={n.href} className="block rounded-[2px] px-2 py-1.5 text-muted hover:bg-panel hover:text-text">{n.label}</Link></li>)}
          </ul>
        </nav>
        <article className="docs min-w-0 flex-1 pb-16">
          <div className="mb-4 flex gap-2 overflow-x-auto md:hidden">{NAV.map((n) => <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-[2px] border border-line px-2 py-1 text-2xs text-muted">{n.label}</Link>)}</div>
          {children}
        </article>
      </div>
      <SiteFooter />
    </div>
  );
}
