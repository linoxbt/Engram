import type { Metadata } from "next";
import type { ReactNode } from "react";

// Keep the site-wide " · Engram" suffix for every page below; each page sets its own title.
export const metadata: Metadata = { title: { default: "Dashboard", template: "%s · Engram" }, robots: { index: false } };
export default function AppLayout({ children }: { children: ReactNode }) {
  return children;
}
