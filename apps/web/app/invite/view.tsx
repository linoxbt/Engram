"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AuthCard } from "@/components/auth-card";
import { Button, ErrorNote, Skeleton } from "@/components/ui";
import { api } from "@/lib/client/api";
import { when } from "@/lib/format";

interface Preview { spaceName: string; invitedBy: string; email: string | null; expiresAt: string }

export function InviteView({ token }: { token: string }) {
  const router = useRouter();
  const here = `/invite?token=${encodeURIComponent(token)}`;
  const preview = useQuery({ queryKey: ["invite", token], queryFn: () => api<Preview>(`/api/invites?token=${encodeURIComponent(token)}`), enabled: !!token, retry: false });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: { email: string } | null }>("/api/auth/me") });
  const accept = useMutation({
    mutationFn: () => api<{ spaceKey: string }>("/api/invites", { method: "POST", json: { token } }),
    onSuccess: (r) => { router.push(`/app/${r.spaceKey}`); router.refresh(); },
  });
  const p = preview.data;
  const user = me.data?.user;

  return (
    <AuthCard
      title={p ? `Join ${p.spaceName}` : "Join a space"}
      subtitle={p ? <>{p.invitedBy} invited you to this Engram space. The invite expires {when(p.expiresAt)}.</> : "Open the link from your invitation."}
      footer={<Link href="/" className="text-accent underline-offset-2 hover:underline">What is Engram?</Link>}
    >
      <div className="space-y-3 text-xs">
        {(!token || preview.isError) && <ErrorNote error={preview.error ?? new Error("This invite link is incomplete.")} />}
        {(preview.isLoading || me.isLoading) && token && <Skeleton className="h-10" />}
        {p && !me.isLoading && (user ? (
          <>
            <p className="text-muted">Signed in as <span className="text-text">{user.email}</span>.{p.email && p.email !== user.email.toLowerCase() ? <> This invite is for <span className="text-text">{p.email}</span>.</> : null}</p>
            <ErrorNote error={accept.error} />
            <Button variant="primary" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>Join space</Button>
          </>
        ) : (
          <>
            <p className="text-muted">{p.email ? <>This invite is for <span className="text-text">{p.email}</span>. </> : null}Sign in or create an account to join.</p>
            <div className="grid gap-2">
              <Link href={`/login?next=${encodeURIComponent(here)}`} className="inline-flex h-9 items-center justify-center rounded-[2px] bg-accent text-sm text-bg">Sign in</Link>
              <Link href={`/signup?next=${encodeURIComponent(here)}`} className="inline-flex h-9 items-center justify-center rounded-[2px] border border-line-2 text-sm">Create an account</Link>
            </div>
          </>
        ))}
      </div>
    </AuthCard>
  );
}
