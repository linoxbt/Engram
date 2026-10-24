import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmail } from "./verify";

export const metadata: Metadata = { title: "Verify your email", robots: { index: false } };
export default function Page() { return <Suspense><VerifyEmail /></Suspense>; }
