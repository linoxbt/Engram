import { route } from "@/lib/server/api";
import { currentUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const GET = route(async () => ({ user: await currentUser() }));
