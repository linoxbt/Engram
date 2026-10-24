"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true); setError(null);
    try { setSent(await api<{ devLink?: string }>("/api/auth/recovery", { method: "POST", json: { email } })); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  return (
    <AuthCard title="Reset your password" subtitle="Enter your account email and we will send you a link to choose a new password."
      footer={<Link href="/login" className="text-accent underline-offset-2 hover:underline">Back to sign in</Link>}>
      {sent ? (
        <div className="space-y-3 text-xs">
          <p className="rounded-[2px] border border-valid/40 bg-valid/5 px-3 py-2.5 text-valid">If an account exists for {email}, a reset link is on its way. It expires in one hour.</p>
          <p className="text-muted">Nothing after a few minutes? Check your spam folder, or try again.</p>
          {sent.devLink && <p className="break-all text-2xs text-muted">Local backend (no email): <a className="text-text underline" href={sent.devLink}>open the reset link</a></p>}
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={loading}>Send reset link</Button>
        </form>
      )}
    </AuthCard>
  );
}
