"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/client/report";

/** Last resort when the root layout itself fails: plain markup, no app styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError("boundary", error, error.digest); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>Engram hit an unexpected error</h1>
          <p style={{ color: "#666", fontSize: 14 }}>It has been reported. {error.digest ? `Reference ${error.digest}.` : ""}</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 999, border: 0, background: "#0a0a0a", color: "#fff" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
