"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";

/** The landing page is static; whether its calls to action lead to the console is decided in the browser. */
export function SessionLink({ signedIn, signedOut, className, children }: { signedIn: string; signedOut: string; className?: string; children?: ReactNode }) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: { id: string } | null }>("/api/auth/me"), staleTime: 60_000, retry: false });
  const user = !!me.data?.user;
  return <Link href={user ? "/app" : "/signup"} className={className}>{user ? signedIn : signedOut}{children}</Link>;
}
