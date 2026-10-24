"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { IconLogo } from "./icons";
import { Button, ErrorNote, Field, Input } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true); setError(null);
    try {
      await api(`/api/auth/${mode}`, { method: "POST", json: mode === "signup" ? { email, password, name } : { email, password } });
      router.push(next && next.startsWith("/") ? next : "/app");
      router.refresh();
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  return (
    <div className="grid-bg flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <Link href="/" className="mb-6 flex items-center gap-2"><IconLogo size={20} /><span className="font-semibold tracking-[0.2em]">ENGRAM</span></Link>
        <h1 className="text-base">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 text-xs text-muted">{mode === "login" ? "Welcome back." : "Spaces, agent keys and the Tamper Lab are one step away."}</p>
        <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {mode === "signup" && <Field label="Name"><Input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>}
          <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password" help={mode === "signup" ? "At least 8 characters." : undefined}><Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={loading}>{mode === "login" ? "Sign in" : "Create account"}</Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted">
          {mode === "login" ? <>New here? <Link className="text-cyan" href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link></> : <>Have an account? <Link className="text-cyan" href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link></>}
        </p>
      </div>
    </div>
  );
}
