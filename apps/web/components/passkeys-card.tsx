"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/client/api";
import { addPasskey, defaultPasskeyName, passkeysSupported, signInWithPasskey, type Passkey } from "@/lib/client/passkeys";
import { useHydrated } from "@/lib/client/hydrated";
import { IconKey } from "./icons";
import { useIsGuest } from "./space-context";
import { Button, Card, ErrorNote, Field, Input, Modal, SignUpNote, Skeleton, useToast } from "./ui";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never");

/**
 * Passkeys on the Account page. Adding or removing one needs a sign-in in the last 10 minutes; when the server
 * says so, the person confirms with their password or a passkey and the action runs again.
 */
export function PasskeysCard({ user }: { user: { id: string; email: string } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const hydrated = useHydrated();
  // Adding a passkey to the shared demo guest is refused by the server, so the control is not offered.
  const guest = useIsGuest();
  const list = useQuery({ queryKey: ["passkeys"], queryFn: () => api<{ passkeys: Passkey[] }>("/api/auth/passkeys") });
  const [name, setName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [reauth, setReauth] = useState<null | (() => Promise<unknown>)>(null);

  /** Run an action; if it needs a fresh sign-in, ask for one and run it again afterwards. */
  const guarded = (action: () => Promise<unknown>) => async () => {
    try { return await action(); } catch (e) {
      if (e instanceof ApiError && e.code === "reauth_required") { setReauth(() => action); return null; }
      throw e;
    }
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: ["passkeys"] });

  const add = useMutation({
    mutationFn: guarded(() => addPasskey((name ?? "").trim() || defaultPasskeyName())),
    onSuccess: (p) => { if (p) { setName(null); refresh(); toast("Passkey added", "ok"); } },
  });
  const rename = useMutation({
    mutationFn: (r: { id: string; name: string }) => api(`/api/auth/passkeys/${encodeURIComponent(r.id)}`, { method: "PATCH", json: { name: r.name } }),
    onSuccess: () => { setRenaming(null); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (p: Passkey) => guarded(() => api(`/api/auth/passkeys/${encodeURIComponent(p.id)}`, { method: "DELETE" }))(),
    onSuccess: (r) => { if (r) { setRemoving(null); refresh(); toast("Passkey removed", "ok"); } },
  });

  const supported = hydrated && passkeysSupported();
  const passkeys = list.data?.passkeys ?? [];

  return (
    <Card title="Passkeys">
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">
          Sign in with your fingerprint, face or device PIN instead of a password. A passkey stays on your device or password manager; Engram only keeps its public key.
        </p>
        {list.isLoading && <Skeleton className="h-12" />}
        <ErrorNote error={list.error} />
        {passkeys.length > 0 && (
          <ul className="divide-y divide-line rounded-[2px] border border-line">
            {passkeys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-xs">
                <IconKey size={13} className="shrink-0 text-muted" />
                {renaming?.id === p.id ? (
                  <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (renaming.name.trim()) rename.mutate({ id: p.id, name: renaming.name.trim() }); }}>
                    <Input autoFocus aria-label="Passkey name" maxLength={128} value={renaming.name} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} className="h-8 flex-1" />
                    <Button type="submit" size="sm" variant="primary" loading={rename.isPending}>Save</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{p.name}</div>
                      <div className="text-2xs text-muted">Added {when(p.createdAt)} · last used {when(p.lastUsedAt)}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: p.id, name: p.name })}>Rename</Button>
                    <Button size="sm" variant="ghost" className="!text-tamper" onClick={() => setRemoving(p)}>Remove</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorNote error={rename.error} />
        {guest ? (
          <SignUpNote>A demo guest cannot add a passkey.</SignUpNote>
        ) : !supported && hydrated ? (
          <p className="text-2xs text-muted">This browser does not support passkeys.</p>
        ) : name === null ? (
          <Button variant="outline" onClick={() => setName(defaultPasskeyName())} disabled={!supported}><IconKey size={13} /> Add a passkey</Button>
        ) : (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <Field label="Name this passkey"><Input autoFocus maxLength={128} value={name} onChange={(e) => setName(e.target.value)} className="w-64 max-w-full" /></Field>
            <Button type="submit" variant="primary" loading={add.isPending}>Create passkey</Button>
            <Button type="button" variant="ghost" onClick={() => { setName(null); add.reset(); }}>Cancel</Button>
          </form>
        )}
        <ErrorNote error={add.error} />
      </div>

      <Modal open={!!removing} onClose={() => { setRemoving(null); remove.reset(); }} title="Remove passkey">
        <div className="space-y-4 text-xs">
          <p className="text-muted">
            <span className="text-text">{removing?.name}</span> will no longer sign you in to Engram. It may stay saved on the device; you can delete it there too.
          </p>
          <ErrorNote error={remove.error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="primary" className="!border-tamper !bg-tamper" loading={remove.isPending} onClick={() => removing && remove.mutate(removing)}>Remove</Button>
          </div>
        </div>
      </Modal>

      <ConfirmIdentity
        open={!!reauth}
        user={user}
        onClose={() => setReauth(null)}
        onConfirmed={async () => {
          const retry = reauth;
          setReauth(null);
          if (!retry) return;
          try { await retry(); setRemoving(null); setName(null); refresh(); toast("Done", "ok"); } catch (e) { toast(e instanceof Error ? e.message : "That did not work. Try again.", "error"); }
        }}
      />
    </Card>
  );
}

function ConfirmIdentity({ open, user, onClose, onConfirmed }: { open: boolean; user: { id: string; email: string }; onClose: () => void; onConfirmed: () => Promise<void> }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
  const done = async () => { setError(null); await onConfirmed(); };
  const withPassword = async (form: HTMLFormElement) => {
    setBusy("password"); setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { email: user.email, password: String(new FormData(form).get("password") ?? "") } });
      await done();
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const withPasskey = async () => {
    setBusy("passkey"); setError(null);
    try {
      await signInWithPasskey();
      // A device can hold passkeys for several accounts; the change must still apply to this one.
      const me = await api<{ user: { id: string } | null }>("/api/auth/me");
      if (me.user?.id !== user.id) { window.location.reload(); return; }
      await done();
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={() => { setError(null); onClose(); }} title="Confirm it's you">
      <form method="post" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void withPassword(e.currentTarget); }}>
        <p className="text-xs text-muted">Changing passkeys needs a recent sign-in. Confirm with your password or one of your passkeys.</p>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <ErrorNote error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          {passkeysSupported() && <Button type="button" variant="outline" loading={busy === "passkey"} disabled={!!busy} onClick={() => void withPasskey()}><IconKey size={13} /> Use a passkey</Button>}
          <Button type="submit" variant="primary" loading={busy === "password"} disabled={!!busy}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}
