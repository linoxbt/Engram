import { SpacesPage } from "./spaces-page";
import { requireUserPage } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUserPage("/app");
  return <SpacesPage userName={user.name} />;
}
