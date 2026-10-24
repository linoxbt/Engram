import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: { default: "Legal", template: "%s · Engram" } };

const NAV = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/cookies", label: "Cookie Policy" },
];

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8">
        <nav className="hidden w-44 shrink-0 md:block" aria-label="Legal">
          <ul className="sticky top-20 space-y-1 text-xs">
            {NAV.map((n) => <li key={n.href}><Link href={n.href} className="block rounded-[2px] px-2 py-1.5 text-muted hover:bg-panel hover:text-text">{n.label}</Link></li>)}
          </ul>
        </nav>
        <article className="docs min-w-0 max-w-3xl flex-1 pb-16">
          <div className="mb-4 flex gap-2 overflow-x-auto md:hidden">{NAV.map((n) => <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-[2px] border border-line px-2 py-1 text-2xs text-muted">{n.label}</Link>)}</div>
          {children}
          <p className="mt-10 border-t border-line pt-4 !text-xs !text-muted">Effective {LEGAL.effective}. Questions about these documents: {LEGAL.contactEmail ? <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> : <a href={`${LEGAL.repo}/issues`}>open an issue on GitHub</a>}.</p>
        </article>
      </div>
      <SiteFooter />
    </div>
  );
}
