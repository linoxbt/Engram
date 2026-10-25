import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextFor } from "@/lib/client/safe-next";
import { currentUser } from "@/lib/server/session";
import { AcceptTermsForm } from "./form";

export const metadata: Metadata = { title: "Accept the Terms" };
export const dynamic = "force-dynamic";

/**
 * Accounts created directly against Appwrite (with the public project ID) never saw the sign-up form's Terms box.
 * Every API call answers terms_required until they accept here.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = typeof sp.next === "string" ? sp.next : null;
  // Same rule as the browser's safeNext, against a placeholder origin: only a same-site path survives.
  const next = safeNextFor(raw, "https://engram.invalid");
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/accept-terms?next=${encodeURIComponent(next)}`)}`);
  if (user.termsAcceptedAt) redirect(next);
  return <AcceptTermsForm next={next} email={user.email} />;
}
