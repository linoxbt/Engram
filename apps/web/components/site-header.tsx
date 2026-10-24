import Link from "next/link";
import { CookieSettingsLink } from "./cookie-settings-link";
import { Wordmark } from "./icons";

export function SiteHeader({ signedIn }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" aria-label="Engram home"><Wordmark /></Link>
        <nav className="flex items-center gap-4 text-xs text-muted sm:gap-6">
          <Link href="/docs" className="hover:text-text">Docs</Link>
          <Link href="/verify" className="hidden hover:text-text sm:inline">Verify</Link>
          <a href="https://github.com/linoxbt/Engram" className="hidden hover:text-text sm:inline">GitHub</a>
          {signedIn ? (
            <Link href="/app" className="rounded-[2px] border border-accent px-3 py-1.5 text-accent hover:bg-accent/10">Dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="hover:text-text">Sign in</Link>
              <Link href="/signup" className="rounded-[2px] border border-accent px-3 py-1.5 text-accent hover:bg-accent/10">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-2xs text-muted sm:flex-row sm:justify-between">
        <span>Engram · memory you can prove · built solo for the Appwrite Databases Hackathon, 19–31 October 2026</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/legal/terms" className="hover:text-text">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-text">Privacy</Link>
          <Link href="/legal/cookies" className="hover:text-text">Cookies</Link>
          <CookieSettingsLink className="hover:text-text" />
        </span>
      </div>
    </footer>
  );
}
