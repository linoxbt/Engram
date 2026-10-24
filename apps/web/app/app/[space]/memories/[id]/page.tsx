"use client";
import { useParams, useRouter } from "next/navigation";
import { MemoryDrawer } from "@/components/memory-drawer";

/** Deep link to a memory: opens the detail as a drawer over the explorer. */
export default function MemoryPage() {
  const { space, id } = useParams<{ space: string; id: string }>();
  const router = useRouter();
  return <MemoryDrawer spaceKey={space} id={id} onClose={() => router.push(`/app/${space}/memories`)} onNavigate={(next) => router.push(`/app/${space}/memories/${next}`)} />;
}
