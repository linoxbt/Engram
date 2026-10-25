"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { openCookieSettings } from "@/lib/client/consent";
import { PasskeysCard } from "@/components/passkeys-card";
import { Button, Card, CopyButton, ErrorNote, Field, Input, Modal, PageHeader, Pill, Skeleton, Stat, useToast } from "@/components/ui";
import { useHealth, useSpaces } from "@/lib/client/workspace";

interface Me { id: string; email: string; name: string; emailVerified?: boolean }

export function View() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: Me | null }>("/api/auth/me") });
  const spaces = useSpaces();
  const health = useHealth();
  const list = spaces.data?.spaces ?? [];
  const owned = list.filter((s) => s.owner);
  const u = me.data?.user;
  const appwrite = health.data?.backend === "appwrite";

  const [name, setName] = useState<string | null>(null);
  const rename = useMutation({
    mutationFn: (n: string) => api("/api/auth/me", { method: "PATCH", json: { name: n } }),
    onSuccess: () => { setName(null); qc.invalidateQueries({ queryKey: ["me"] }); router.refresh(); toast("Name updated", "ok"); },
  });

  const [devLink, setDevLink] = useState<string | null>(null);
  const resend = useMutation({
    mutationFn: () => api<{ devLink?: string; alreadyVerified?: boolean }>("/api/auth/verification", { method: "POST" }),
    onSuccess: (r) => { setDevLink(r.devLink ?? null); toast(r.alreadyVerified ? "Already verified" : "Verification email sent", "ok"); },
  });

  const [pw, setPw] = useState({ old: "", next: "", confirm: "" });
  const [pwError, setPwError] = useState<unknown>(null);
  const changePw = useMutation({
    mutationFn: () => api("/api/auth/password", { method: "POST", json: { oldPassword: pw.old, password: pw.next } }),
    onSuccess: () => { setPw({ old: "", next: "", confirm: "" }); setPwError(null); toast("Password changed", "ok"); },
    onError: (e) => setPwError(e),
  });

  const [del, setDel] = useState<{ open: boolean; password: string; confirm: string }>({ open: false, password: "", confirm: "" });
  const remove = useMutation({
    mutationFn: () => api("/api/auth/me", { method: "DELETE", json: { password: del.password, confirm: del.confirm } }),
    onSuccess: () => { qc.clear(); router.push("/"); router.refresh(); },
  });

  const signOut = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => { qc.clear(); router.push("/"); },
    onError: (e) => toast(`Could not sign out: ${e instanceof Error ? e.message : String(e)}`, "error"),
  });

  return (
    <>
      <PageHeader title="Account">Your identity in Engram. People sign in here; agents use their own keys.</PageHeader>
      {me.isLoading && <Skeleton className="h-40" />}
      {me.error ? <ErrorNote error={me.error} /> : null}
      {me.data && !u && <ErrorNote error="You are signed out. Sign in again to see your account." />}
      {u && (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-5">
            <Card title="Profile">
              <div className="flex items-center gap-4 p-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-lg font-semibold uppercase text-bg">{u.name.slice(0, 1) || "?"}</span>
                {name === null ? (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{u.name}</div>
                    <div className="truncate text-xs text-muted">{u.email}</div>
                  </div>
                ) : (
                  <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate(name.trim()); }}>
                    <Input autoFocus aria-label="Name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
                    <Button type="submit" variant="primary" loading={rename.isPending}>Save</Button>
                    <Button type="button" variant="ghost" onClick={() => setName(null)}>Cancel</Button>
                  </form>
                )}
                {name === null && <Button variant="outline" size="sm" onClick={() => setName(u.name)}>Edit name</Button>}
              </div>
              {rename.error && <div className="px-4 pb-3"><ErrorNote error={rename.error} /></div>}
              <dl className="divide-y divide-line border-t border-line text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <dt className="text-muted">Email</dt>
                  <dd className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all">{u.email}</span>
                    {u.emailVerified ? <Pill tone="valid">verified</Pill> : <Pill tone="warning">not verified</Pill>}
                    {!u.emailVerified && <Button size="sm" variant="outline" loading={resend.isPending} onClick={() => resend.mutate()}>Resend link</Button>}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-muted">User ID</dt><dd className="flex min-w-0 items-center gap-2"><code className="truncate">{u.id}</code><CopyButton value={u.id} /></dd></div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Sign-in</dt><dd className="min-w-0">{appwrite ? "Appwrite Auth · email and password, or a passkey" : "Local demo store · email and password, or a passkey"}</dd></div>
              </dl>
              {(resend.error || devLink) && (
                <div className="space-y-2 border-t border-line px-4 py-3 text-2xs">
                  <ErrorNote error={resend.error} />
                  {devLink && <a href={devLink} className="break-all text-text underline">Local backend (no email): open the verification link</a>}
                </div>
              )}
            </Card>

            <Card title="Password">
              <form className="grid gap-3 p-4 sm:grid-cols-3" onSubmit={(e) => {
                e.preventDefault();
                if (pw.next !== pw.confirm) { setPwError(new Error("The new passwords do not match.")); return; }
                changePw.mutate();
              }}>
                <Field label="Current password"><Input type="password" autoComplete="current-password" required maxLength={256} value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} /></Field>
                <Field label="New password"><Input type="password" autoComplete="new-password" required minLength={8} maxLength={256} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
                <Field label="Confirm new password"><Input type="password" autoComplete="new-password" required minLength={8} maxLength={256} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                  <Button type="submit" variant="primary" loading={changePw.isPending}>Change password</Button>
                  <Link href="/forgot-password" className="text-2xs text-muted underline-offset-2 hover:text-text hover:underline">Forgot your current password?</Link>
                </div>
                {pwError ? <div className="sm:col-span-3"><ErrorNote error={pwError} /></div> : null}
              </form>
            </Card>

            <PasskeysCard user={u} />

            <Card title="Your spaces">
              {spaces.error ? <div className="px-4 pt-4"><ErrorNote error={spaces.error} /></div> : null}
              <div className="grid grid-cols-3 gap-3 p-4">
                <Stat label="Owned" value={owned.length} />
                <Stat label="Member" value={list.length - owned.length} />
                <Stat label="Sandboxes" value={list.filter((s) => s.sandbox).length} tone="muted" />
              </div>
              <div className="border-t border-line px-4 py-3 text-xs"><Link href="/app" className="underline underline-offset-2">Manage spaces</Link></div>
            </Card>

            <Card title="Danger zone" state="tampered">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs">
                  <div className="text-tamper">Delete your account</div>
                  <p className="mt-1 max-w-md text-muted">Permanently removes your account and every space you own, including their memories and checkpoints. This cannot be undone.</p>
                </div>
                <Button variant="outline" className="!border-tamper/60 !text-tamper" onClick={() => setDel({ open: true, password: "", confirm: "" })}>Delete account</Button>
              </div>
            </Card>
          </div>

          <div className="min-w-0 space-y-5">
            <Card title="Session">
              <div className="space-y-3 p-4 text-xs text-muted">
                <p>You are signed in on this device with an HTTP-only session cookie. Agents never use it; they authenticate with scoped keys.</p>
                <Button variant="outline" loading={signOut.isPending} onClick={() => signOut.mutate()}>Sign out</Button>
              </div>
            </Card>
            <Card title="Privacy">
              <div className="space-y-2 p-4 text-xs text-muted">
                <p>Engram uses essential cookies only. No advertising or analytics trackers.</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <button onClick={openCookieSettings} className="text-text underline underline-offset-2">Cookie settings</button>
                  <Link href="/legal/privacy" className="text-text underline underline-offset-2">Privacy Policy</Link>
                  <Link href="/legal/terms" className="text-text underline underline-offset-2">Terms</Link>
                </div>
              </div>
            </Card>
            <Card title="Your data">
              <p className="p-4 text-xs text-muted">Each space can be exported in full from its Settings page, entries, checkpoints and proofs included, so anyone can verify it offline.</p>
            </Card>
          </div>
        </div>
      )}

      <Modal open={del.open} onClose={() => setDel({ ...del, open: false })} title="Delete your account">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); remove.mutate(); }}>
          <p className="text-xs text-muted">This permanently deletes your account{owned.length ? <> and these {owned.length} space{owned.length === 1 ? "" : "s"} you own:</> : "."}</p>
          {owned.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-[2px] border border-tamper/30 bg-tamper/5 px-3 py-2 text-xs">
              {owned.map((s) => <li key={s.key}>{s.name} <span className="text-muted tabular">{s.key}</span></li>)}
            </ul>
          )}
          <Field label="Your password"><Input type="password" autoComplete="current-password" required maxLength={256} value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></Field>
          <Field label="Type DELETE to confirm"><Input required value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} /></Field>
          <ErrorNote error={remove.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDel({ ...del, open: false })}>Cancel</Button>
            <Button type="submit" variant="primary" className="!border-tamper !bg-tamper" loading={remove.isPending} disabled={del.confirm !== "DELETE" || !del.password}>Delete permanently</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
