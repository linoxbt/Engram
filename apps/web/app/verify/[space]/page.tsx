import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicVerifier } from "./verifier";

export async function generateMetadata({ params }: { params: Promise<{ space: string }> }): Promise<Metadata> {
  const { space } = await params;
  return { title: `Verify ${space}`, description: "Independent, in-browser verification of an Engram memory chain." };
}

export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  const { space } = await params;
  return <Suspense><PublicVerifier space={space} /></Suspense>;
}
