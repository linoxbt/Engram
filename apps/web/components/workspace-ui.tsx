"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Health } from "@/lib/client/workspace";
import { Card, Empty } from "./ui";

/** Shown instead of per-space data while Appwrite's memory database is not provisioned. */
export function StorageNotice({ health }: { health: Health | undefined }) {
  if (!health?.database || health.database.ok) return null;
  return (
    <div role="alert" className="mb-5 rounded-[2px] border border-warn/50 bg-warn/5 px-4 py-3 text-xs">
      <div className="font-medium text-warn">Memory storage is not available yet</div>
      <div className="mt-1 text-muted">{health.database.error}</div>
      <Link href="/app/status" className="mt-2 inline-block text-text underline underline-offset-2">See system status</Link>
    </div>
  );
}

export function SpaceTag({ spaceKey, name }: { spaceKey: string; name: string }) {
  return (
    <Link href={`/app/${spaceKey}`} className="inline-flex h-5 max-w-[12rem] items-center truncate rounded-[2px] border border-line-2 px-1.5 text-2xs text-muted hover:border-accent hover:text-text" title={spaceKey}>
      {name}
    </Link>
  );
}

export function NoSpaces({ children }: { children?: ReactNode }) {
  return (
    <Card>
      <Empty title="No spaces yet" action={<Link href="/app" className="inline-flex h-8 items-center rounded-[2px] bg-accent px-3 text-xs text-bg">Go to Spaces</Link>}>
        {children ?? "Create a space first. This page gathers data from every space you belong to."}
      </Empty>
    </Card>
  );
}
