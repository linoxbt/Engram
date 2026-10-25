import type { Metadata } from "next";
import { InviteView } from "./view";

export const metadata: Metadata = { title: "Join a space", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <InviteView token={typeof token === "string" ? token : ""} />;
}
