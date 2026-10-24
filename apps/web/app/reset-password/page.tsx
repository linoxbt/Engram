import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetForm } from "./form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };
export default function Page() { return <Suspense><ResetForm /></Suspense>; }
