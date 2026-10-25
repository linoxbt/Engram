import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="grid-bg flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md p-6 text-center">
        <p className="label">404</p>
        <h1 className="mt-2 text-base">No entry at this address</h1>
        <p className="mt-2 text-xs text-muted">The page does not exist, or you are not a member of this space.</p>
        <Link href="/" className="mt-4 inline-block text-xs text-accent hover:underline">Back to Engram</Link>
      </div>
    </div>
  );
}
