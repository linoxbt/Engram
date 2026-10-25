import type { Metadata } from "next";
import { PublicVerifier } from "./verifier";

export async function generateMetadata({ params }: { params: Promise<{ space: string }> }): Promise<Metadata> {
  const { space } = await params;
  return { title: `Verify ${space}`, description: "Independent, in-browser verification of an Engram memory chain." };
}

/** The proof parameter is read here, so the verifier's frame renders on the server instead of an empty Suspense. */
export default async function Page({ params, searchParams }: { params: Promise<{ space: string }>; searchParams: Promise<{ proof?: string | string[] }> }) {
  const [{ space }, sp] = await Promise.all([params, searchParams]);
  const proof = typeof sp.proof === "string" ? sp.proof : null;
  return <PublicVerifier space={space} proofId={proof} />;
}
