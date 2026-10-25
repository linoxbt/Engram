"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { when } from "@/lib/format";
import { Button, Card, CopyButton, ErrorNote, Field, Input, Modal, Pill, Skeleton, useToast } from "./ui";

interface Member { userId: string; name: string; email: string; owner: boolean }
interface Invite { id: string; email: string | null; createdAt: string; expiresAt: string }

/** People in a space. The owner invites with single-use links (shown once) and can remove members. */
export function MembersCard({ space, owner, sandbox }: { space: string; owner: boolean; sandbox: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["space", space, "members"];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ members: Member[]; invites: Invite[] }>(`/api/app/spaces/${space}/members`) });
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const invite = useMutation({
    mutationFn: () => api<{ url: string }>(`/api/app/spaces/${space}/members`, { method: "POST", json: { email: email.trim() || null } }),
    onSuccess: (r) => { setLink(r.url); setEmail(""); refresh(); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/app/spaces/${space}/invites/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); toast("Invite revoked", "ok"); },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api(`/api/app/spaces/${space}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    onSuccess: () => { setRemoving(null); refresh(); toast("Member removed", "ok"); },
  });

  const members = q.data?.members ?? [];
  const invites = q.data?.invites ?? [];

  return (
    <Card title="Members">
      <div className="space-y-3 p-4 text-xs">
        <p className="text-muted">Members can read and write this space&rsquo;s memories, run recalls and verify the chain. Only the owner changes settings, agents and membership.</p>
        {q.isLoading && <Skeleton className="h-12" />}
        <ErrorNote error={q.error} />
        {members.length > 0 && (
          <ul className="divide-y divide-line rounded-[2px] border border-line">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{m.name || m.email}</div>
                  {m.name && <div className="truncate text-2xs text-muted">{m.email}</div>}
                </div>
                {m.owner ? <Pill tone="valid">owner</Pill> : <Pill tone="muted">member</Pill>}
                {owner && !m.owner && <Button size="sm" variant="ghost" className="!text-tamper" onClick={() => setRemoving(m)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}

        {owner && !sandbox && (
          <div className="space-y-3 border-t border-line pt-3">
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
              <Field label="Invite someone" help="Leave the email empty for a link anyone can use once. Links expire after 7 days.">
                <Input type="email" placeholder="name@example.com (optional)" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className="w-72 max-w-full" />
              </Field>
              <Button type="submit" variant="primary" loading={invite.isPending}>Create invite link</Button>
            </form>
            <ErrorNote error={invite.error} />
            {link && (
              <div className="space-y-1.5 rounded-[2px] border border-valid/40 bg-valid/5 p-3">
                <div className="text-valid">Invite link created. Copy it now: it is shown only once.</div>
                <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate">{link}</code><CopyButton value={link} /></div>
              </div>
            )}
            {invites.length > 0 && (
              <div>
                <div className="label mb-1.5">Pending invites</div>
                <ul className="divide-y divide-line rounded-[2px] border border-line">
                  {invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{i.email ?? "Anyone with the link"}</span>
                      <span className="text-2xs text-muted">expires {when(i.expiresAt)}</span>
                      <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id)}>Revoke</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {owner && sandbox && <p className="text-2xs text-muted">Sandboxes are private to their owner, so they cannot be shared.</p>}
      </div>

      <Modal open={!!removing} onClose={() => { setRemoving(null); remove.reset(); }} title="Remove member">
        <div className="space-y-4 text-xs">
          <p className="text-muted"><span className="text-text">{removing?.name || removing?.email}</span> will lose access to this space. Entries they wrote stay in the chain.</p>
          <ErrorNote error={remove.error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="primary" className="!border-tamper !bg-tamper" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.userId)}>Remove</Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
