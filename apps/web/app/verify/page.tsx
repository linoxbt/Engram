"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconShield } from "@/components/icons";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { Button, Input } from "@/components/ui";

export default function VerifyIndex() {
  const router = useRouter();
  const [key, setKey] = useState("");
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-16">
        <IconShield size={28} className="text-gold" />
        <h1 className="mt-4 text-lg">Public verifier</h1>
        <p className="prose-sans mt-2 text-sm text-muted">Enter a space key. This page downloads the public header data and signed checkpoints, and recomputes every hash and signature in your browser. It never sees memory text.</p>
        <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (/^[a-z0-9]{8}$/.test(key.trim())) router.push(`/verify/${key.trim()}`); }}>
          <Input aria-label="Space key" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} placeholder="k7m2q9xa" pattern="[a-z0-9]{8}" className="h-10" />
          <Button type="submit" variant="gold" className="h-10">Verify</Button>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
