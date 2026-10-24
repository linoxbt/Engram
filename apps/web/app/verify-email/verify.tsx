"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { api } from "@/lib/client/api";

export function VerifyEmail() {
  const params = useSearchParams();
  const userId = params.get("userId") ?? "";
  const secret = params.get("secret") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">(userId && secret ? "working" : "failed");
  const [message, setMessage] = useState("This verification link is missing its token.");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !userId || !secret) return;
    ran.current = true;
    api("/api/auth/verification/complete", { method: "POST", json: { userId, secret } })
      .then(() => setState("done"))
      .catch((e: unknown) => { setMessage(e instanceof Error ? e.message : String(e)); setState("failed"); });
  }, [userId, secret]);
  return (
    <AuthCard
      title={state === "done" ? "Email verified" : state === "working" ? "Verifying…" : "Verification failed"}
      subtitle={state === "done" ? "Thanks. Your email address is confirmed." : state === "working" ? "Confirming your email address." : message}
      footer={<Link href="/app" className="text-accent underline-offset-2 hover:underline">Go to Engram</Link>}>
      {state === "done" && <Link href="/app" className="inline-flex h-9 w-full items-center justify-center rounded-[2px] bg-accent text-sm text-bg">Continue</Link>}
      {state === "failed" && <Link href="/app/account" className="inline-flex h-9 w-full items-center justify-center rounded-[2px] border border-line-2 text-sm">Send a new link from your account</Link>}
    </AuthCard>
  );
}
