"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { Button, Card, CopyButton, PageHeader, Skeleton, Stat } from "@/components/ui";
import { useHealth, useSpaces } from "@/lib/client/workspace";

export function View() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: { id: string; email: string; name: string } | null }>("/api/auth/me") });
  const spaces = useSpaces();
  const health = useHealth();
  const list = spaces.data?.spaces ?? [];
  const u = me.data?.user;
  const appwrite = health.data?.backend === "appwrite";
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }); qc.clear(); router.push("/"); };

  return (
    <>
      <PageHeader title="Account">Your identity in Engram. People sign in here; agents use their own keys.</PageHeader>
      {me.isLoading && <Skeleton className="h-40" />}
      {u && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <Card title="Profile">
              <div className="flex items-center gap-4 p-4">
                <span className="grid size-12 place-items-center rounded-full bg-accent text-lg font-semibold uppercase text-bg">{u.name.slice(0, 1) || "?"}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm">{u.name}</div>
                  <div className="truncate text-xs text-muted">{u.email}</div>
                </div>
              </div>
              <dl className="divide-y divide-line border-t border-line text-xs">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-muted">User ID</dt><dd className="flex min-w-0 items-center gap-2"><code className="truncate">{u.id}</code><CopyButton value={u.id} /></dd></div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Sign-in</dt><dd>{appwrite ? "Appwrite Auth · email and password" : "Local demo store"}</dd></div>
              </dl>
            </Card>
            <Card title="Your spaces">
              <div className="grid grid-cols-3 gap-3 p-4">
                <Stat label="Owned" value={list.filter((s) => s.owner).length} />
                <Stat label="Member" value={list.filter((s) => !s.owner).length} />
                <Stat label="Sandboxes" value={list.filter((s) => s.sandbox).length} tone="muted" />
              </div>
              <div className="border-t border-line px-4 py-3 text-xs"><Link href="/app" className="underline underline-offset-2">Manage spaces</Link></div>
            </Card>
          </div>
          <div className="space-y-5">
            <Card title="Session">
              <div className="space-y-3 p-4 text-xs text-muted">
                <p>You are signed in on this device with an HTTP-only session cookie. Agents never use it; they authenticate with scoped keys.</p>
                <Button variant="outline" onClick={signOut}>Sign out</Button>
              </div>
            </Card>
            <Card title="Your data">
              <p className="p-4 text-xs text-muted">Each space can be exported in full from its Settings page, entries, checkpoints and proofs included, so anyone can verify it offline.</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
