"use client";
import { useParams, useRouter } from "next/navigation";
import { MemoryDrawer } from "@/components/memory-drawer";

export function MemoryDeepLink() {
  const { space, id } = useParams<{ space: string; id: string }>();
  const router = useRouter();
  return (
    <MemoryDrawer spaceKey={space} id={id} onClose={() => router.push(`/app/${space}/memories`, { scroll: false })}
      onNavigate={(next) => router.replace(`/app/${space}/memories/${next}`, { scroll: false })} />
  );
}
