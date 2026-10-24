import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./icons";

/** The frame shared by every sign-in, sign-up and account-recovery screen. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid-bg flex min-h-screen flex-col items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <Link href="/" className="mb-6 inline-flex" aria-label="Engram home"><Wordmark /></Link>
        <h1 className="text-base">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
        {footer && <div className="mt-4 text-center text-xs text-muted">{footer}</div>}
      </div>
      <p className="mt-6 flex gap-4 text-2xs text-muted">
        <Link href="/legal/terms" className="hover:text-text">Terms</Link>
        <Link href="/legal/privacy" className="hover:text-text">Privacy</Link>
        <Link href="/legal/cookies" className="hover:text-text">Cookies</Link>
      </p>
    </div>
  );
}
