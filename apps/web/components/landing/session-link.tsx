"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";

/** The landing page is static; whether its calls to action lead to the console is decided in the browser. */
export function SessionLink({ signedIn, signedOut, className, children }: { signedIn: string; signedOut: string; className?: string; children?: ReactNode }) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: { id: string } | null }>("/api/auth/me"), staleTime: 60_000, retry: false });
  const user = !!me.data?.user;
  // Both labels are laid out on top of each other so the button keeps the wider width and the nav never jumps
  // when the answer arrives. The signed-out label is the one in the server-rendered HTML.
  const other = user ? signedOut : signedIn;
  return (
    <Link href={user ? "/app" : "/signup"} className={className}>
      <span className="grid">
        <span className="invisible col-start-1 row-start-1 h-0" aria-hidden>{other}</span>
        <span className="col-start-1 row-start-1">{user ? signedIn : signedOut}</span>
      </span>
      {children}
    </Link>
  );
}
