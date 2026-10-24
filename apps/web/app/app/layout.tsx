import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };
export default function AppLayout({ children }: { children: ReactNode }) {
  return children;
}
