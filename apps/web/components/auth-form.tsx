"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/client/api";
import { useConsent } from "@/lib/client/consent";
import { useHydrated } from "@/lib/client/hydrated";
import { passkeysSupported, signInWithPasskey } from "@/lib/client/passkeys";
import { safeNext } from "@/lib/client/safe-next";
import { AuthCard } from "./auth-card";
import { CookieNotice } from "./cookie-notice";
import { IconKey } from "./icons";
import { Button, ErrorNote, Field, Input } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const next = params.get("next");
  const consent = useConsent();
  const [error, setError] = useState<unknown>(null);
  // The terms box gates the button; read its real state on mount in case it was ticked before hydration.
  const terms = useRef<HTMLInputElement>(null);
  const [agree, setAgree] = useState(false);
  useEffect(() => { if (terms.current?.checked) setAgree(true); }, []);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const hydrated = useHydrated();
  const cookieError = error instanceof ApiError && error.code === "cookies_required";
  const needsCookies = consent === "declined" || (cookieError && consent !== "accepted");
  // Values come from the form itself, not React state: anything typed before hydration finished still counts.
  const submit = async (form: HTMLFormElement) => {
    const f = new FormData(form);
    const email = String(f.get("email") ?? ""), password = String(f.get("password") ?? ""), name = String(f.get("name") ?? "");
    setLoading(true); setError(null);
    try {
      await api(`/api/auth/${mode}`, { method: "POST", json: mode === "signup" ? { email, password, name, acceptTerms: f.get("acceptTerms") === "on" } : { email, password } });
      qc.clear(); // a new identity must not see answers cached before it signed in
      router.push(safeNext(next));
      router.refresh();
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  const passkey = async () => {
    setPasskeyLoading(true); setError(null);
    try {
      await signInWithPasskey();
      qc.clear();
      router.push(safeNext(next));
      router.refresh();
    } catch (e) { setError(e); } finally { setPasskeyLoading(false); }
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
      {/* method="post" so a submit before hydration can never put the password in the URL. */}
      <form method="post" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
        {mode === "signup" && <Field label="Name"><Input name="name" autoComplete="name" required maxLength={80} /></Field>}
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required maxLength={254} /></Field>
        <Field label="Password" help={mode === "signup" ? "At least 8 characters." : undefined}>
          <Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : 1} maxLength={256} name="password" />
        </Field>
        {mode === "login" && (
          <div className="-mt-1 text-right"><Link href="/forgot-password" className="text-2xs text-muted underline-offset-2 hover:text-text hover:underline">Forgot password?</Link></div>
        )}
        {mode === "signup" && (
          <label className="flex items-start gap-2.5 text-xs text-muted">
            <input ref={terms} type="checkbox" name="acceptTerms" required onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[#0a0a0a]" />
            <span>I agree to the <Link href="/legal/terms" target="_blank" className="text-text underline underline-offset-2">Terms of Service</Link> and <Link href="/legal/privacy" target="_blank" className="text-text underline underline-offset-2">Privacy Policy</Link>, and to Engram&apos;s use of essential cookies.</span>
          </label>
        )}
        {needsCookies ? <CookieNotice /> : <ErrorNote error={cookieError ? null : error} />}
        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!hydrated || consent === "declined" || (mode === "signup" && !agree)}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      {mode === "login" && hydrated && passkeysSupported() && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 text-2xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          <Button type="button" variant="outline" className="w-full" loading={passkeyLoading} disabled={consent === "declined" || loading} onClick={() => void passkey()}>
            <IconKey size={13} /> Sign in with a passkey
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
