import { Suspense } from "react";
import type { Metadata } from "next";
import { InviteView } from "./view";

export const metadata: Metadata = { title: "Join a space", robots: { index: false } };
export default function Page() { return <Suspense><InviteView /></Suspense>; }
