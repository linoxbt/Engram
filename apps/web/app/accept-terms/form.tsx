"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthCard } from "@/components/auth-card";
import { Button, ErrorNote } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useHydrated } from "@/lib/client/hydrated";
import { safeNext } from "@/lib/client/safe-next";

export function AcceptTermsForm({ next, email }: { next: string; email: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const box = useRef<HTMLInputElement>(null);
  const [agree, setAgree] = useState(false);
  useEffect(() => { if (box.current?.checked) setAgree(true); }, []);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const accept = async () => {
    setLoading(true); setError(null);
    try {
      await api("/api/auth/terms", { method: "POST", json: { accept: true } });
      qc.clear();
      router.push(safeNext(next));
      router.refresh();
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    qc.clear();
    router.push("/");
    router.refresh();
  };
  return (
    <AuthCard title="One more step" subtitle={<>Signed in as {email}. Engram needs your agreement before you continue.</>}
      footer={<button type="button" onClick={() => void signOut()} className="text-accent underline-offset-2 hover:underline">Sign out instead</button>}>
      <form method="post" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void accept(); }}>
        <label className="flex items-start gap-2.5 text-xs text-muted">
          <input ref={box} type="checkbox" name="acceptTerms" required onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[#0a0a0a]" />
          <span>I agree to the <Link href="/legal/terms" target="_blank" className="text-text underline underline-offset-2">Terms of Service</Link> and <Link href="/legal/privacy" target="_blank" className="text-text underline underline-offset-2">Privacy Policy</Link>, and to Engram&apos;s use of essential cookies.</span>
        </label>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!hydrated || !agree}>Continue</Button>
      </form>
    </AuthCard>
  );
}
