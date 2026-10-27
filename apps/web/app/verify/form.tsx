"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconShield } from "@/components/icons";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { SPACE_KEY_PATTERN, compilePattern } from "@/lib/client/patterns";
import { Button, Input } from "@/components/ui";

const VALID = compilePattern(SPACE_KEY_PATTERN);
const HINT = "Space keys are 8 lowercase letters or digits.";

export function VerifyIndex() {
  const router = useRouter();
  const [key, setKey] = useState("");
  // `pattern` never runs on an empty value, so an empty or short key used to do nothing at all when Verify was pressed.
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-16">
        <IconShield size={28} className="text-gold" />
        <h1 className="mt-4 text-lg">Public verifier</h1>
        <p className="prose-sans mt-2 text-sm text-muted">Enter a space key. This page downloads the public header data and signed checkpoints, and recomputes every hash and signature in your browser. It never sees memory text.</p>
        <form className="mt-6 flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          const k = key.trim();
          if (!VALID.test(k)) { setError(HINT); return; }
          setError(null);
          router.push(`/verify/${k}`);
        }}>
          <Input aria-label="Space key" aria-describedby={error ? "space-key-hint" : undefined} aria-invalid={error ? true : undefined}
            required minLength={8} maxLength={8} pattern={SPACE_KEY_PATTERN} value={key}
            onInvalid={(e) => { e.preventDefault(); setError(HINT); }}
            onChange={(e) => { setKey(e.target.value.toLowerCase()); setError(null); }} placeholder="k7m2q9xa" className="h-10" />
          <Button type="submit" variant="gold" className="h-10">Verify</Button>
        </form>
        {error && <p id="space-key-hint" role="alert" className="mt-2 text-xs text-tamper">{error}</p>}
      </main>
      <SiteFooter />
    </div>
  );
}
