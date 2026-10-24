"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useConsent } from "@/lib/client/consent";
import { AuthCard } from "./auth-card";
import { CookieNotice } from "./cookie-notice";
import { Button, ErrorNote, Field, Input } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const consent = useConsent();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const needsCookies = consent === "declined" || (error instanceof ApiError && error.code === "cookies_required" && consent !== "accepted");
  const submit = async () => {
    setLoading(true); setError(null);
    try {
      await api(`/api/auth/${mode}`, { method: "POST", json: mode === "signup" ? { email, password, name, acceptTerms: agree } : { email, password } });
      router.push(next && next.startsWith("/") ? next : "/app");
      router.refresh();
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  const keepNext = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <AuthCard
      title={mode === "login" ? "Sign in" : "Create your account"}
      subtitle={mode === "login" ? "Welcome back." : "Spaces, agent keys and the Tamper Lab are one step away."}
      footer={mode === "login"
        ? <>New here? <Link className="text-accent underline-offset-2 hover:underline" href={`/signup${keepNext}`}>Create an account</Link></>
        : <>Have an account? <Link className="text-accent underline-offset-2 hover:underline" href={`/login${keepNext}`}>Sign in</Link></>}
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {mode === "signup" && <Field label="Name"><Input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>}
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" help={mode === "signup" ? "At least 8 characters." : undefined}>
          <Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {mode === "login" && (
          <div className="-mt-1 text-right"><Link href="/forgot-password" className="text-2xs text-muted underline-offset-2 hover:text-text hover:underline">Forgot password?</Link></div>
        )}
        {mode === "signup" && (
          <label className="flex items-start gap-2.5 text-xs text-muted">
            <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[#0a0a0a]" />
            <span>I agree to the <Link href="/legal/terms" target="_blank" className="text-text underline underline-offset-2">Terms of Service</Link> and <Link href="/legal/privacy" target="_blank" className="text-text underline underline-offset-2">Privacy Policy</Link>, and to Engram&apos;s use of essential cookies.</span>
          </label>
        )}
        {needsCookies ? <CookieNotice /> : <ErrorNote error={error} />}
        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={consent === "declined" || (mode === "signup" && !agree)}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
