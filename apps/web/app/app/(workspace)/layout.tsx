import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireUserPage } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const user = await requireUserPage("/app");
  return <WorkspaceShell user={{ name: user.name, email: user.email }}>{children}</WorkspaceShell>;
}
