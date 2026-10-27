import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getBackend, membership } from "@engram/server";
import { SpaceShell } from "@/components/space-shell";
import { requireUserPage } from "@/lib/server/session";

export default async function SpaceLayout({ children, params }: { children: ReactNode; params: Promise<{ space: string }> }) {
  const { space } = await params;
  const user = await requireUserPage(`/app/${space}`);
  const m = await membership(getBackend(), space, user.id).catch(() => null);
  if (!m) notFound();
  return <SpaceShell spaceKey={space} user={{ name: user.name, email: user.email, emailVerified: user.emailVerified, guest: user.guest }}>{children}</SpaceShell>;
}
