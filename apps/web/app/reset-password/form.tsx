"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";

export function ResetForm() {
  const params = useSearchParams();
  const userId = params.get("userId") ?? "";
  const secret = params.get("secret") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (password !== confirm) { setError(new Error("The two passwords do not match.")); return; }
    setLoading(true); setError(null);
    try { await api("/api/auth/recovery/complete", { method: "POST", json: { userId, secret, password } }); setDone(true); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  if (!userId || !secret) {
    return (
      <AuthCard title="Link incomplete" subtitle="This reset link is missing its token. Open the link from your email again, or request a new one."
        footer={<Link href="/forgot-password" className="text-accent underline-offset-2 hover:underline">Request a new link</Link>}>
        <span />
      </AuthCard>
    );
  }
  return (
    <AuthCard title={done ? "Password changed" : "Choose a new password"} subtitle={done ? "You can now sign in with your new password." : "Use at least 8 characters. You will be signed out of other devices."}
      footer={<Link href="/login" className="text-accent underline-offset-2 hover:underline">{done ? "Sign in" : "Back to sign in"}</Link>}>
      {done ? (
        <Link href="/login" className="inline-flex h-9 w-full items-center justify-center rounded-[2px] bg-accent text-sm text-bg">Sign in</Link>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="New password"><Input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Confirm new password"><Input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={loading}>Set new password</Button>
        </form>
      )}
    </AuthCard>
  );
}
