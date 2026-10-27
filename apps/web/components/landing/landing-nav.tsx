"use client";
import clsx from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { IconCross, IconMenu } from "@/components/icons";
import { useLayer } from "@/components/ui";

const useSignedIn = () => !!useQuery({ queryKey: ["me"], queryFn: () => api<{ user: { id: string } | null }>("/api/auth/me"), staleTime: 60_000, retry: false }).data?.user;

/** "Sign in" for visitors who are not signed in (signed-in visitors get "Console" from the main button). */
export function SignInLink({ className }: { className?: string }) {
  const signedIn = useSignedIn();
  // The link is in the server-rendered HTML (it works without JavaScript); once we know the visitor is signed in it
  // keeps its width as empty space, so the nav beside it does not jump.
  if (signedIn) return <span aria-hidden className={clsx(className, "invisible")}>Sign in</span>;
  return <Link href="/login" className={className}>Sign in</Link>;
}

/** Phones: the section links and sign-in live in a menu instead of disappearing. */
export function LandingMenu({ demo }: { demo: string | null }) {
  const [open, setOpen] = useState(false);
  const signedIn = useSignedIn();
  const ref = useRef<HTMLDivElement>(null);
  useLayer(open, () => setOpen(false), ref, { trap: false, focus: "first" });
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, [open]);
  const links: [string, string][] = [["#proof", "Proof"], ["#time", "Time"], ["/docs", "Docs"], ["/verify", "Verify"], ...(demo ? [[`/verify/${demo}`, "Verify the live chain"] as [string, string]] : []), signedIn ? ["/app", "Console"] : ["/login", "Sign in"]];
  return (
    <div className="md:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="landing-menu" aria-label={open ? "Close menu" : "Open menu"}
        className="grid size-9 place-items-center rounded-full border border-line-2 text-text">
        {open ? <IconCross size={15} /> : <IconMenu size={15} />}
      </button>
      {open && (
        <div ref={ref} id="landing-menu" className="l-glass absolute inset-x-0 top-[calc(100%+8px)] !rounded-2xl !bg-bg p-2">
          <ul className="grid">
            {links.map(([href, label]) => (
              <li key={href}>
                {href.startsWith("#")
                  ? <a href={href} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-[15px] text-text hover:bg-panel-2">{label}</a>
                  : <Link href={href} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-[15px] text-text hover:bg-panel-2">{label}</Link>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
