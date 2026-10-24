"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/client/report";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError("boundary", error, error.digest); }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="card max-w-md p-6" data-state="tampered">
        <p className="label text-tamper">Something broke</p>
        <p className="mt-2 text-xs text-muted">{error.message || "An unexpected error occurred."}{error.digest ? ` (ref ${error.digest})` : ""}</p>
        <p className="mt-1 text-2xs text-muted">The error was reported automatically.</p>
        <button onClick={reset} className="mt-4 text-xs text-accent hover:underline">Try again</button>
      </div>
    </div>
  );
}
