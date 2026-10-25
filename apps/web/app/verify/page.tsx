import type { Metadata } from "next";
import { VerifyIndex } from "./form";

export const metadata: Metadata = { title: "Public verifier", description: "Verify any public Engram memory chain in your browser: every hash, Merkle root and signature recomputed, no login." };
export default function Page() {
  return <VerifyIndex />;
}
