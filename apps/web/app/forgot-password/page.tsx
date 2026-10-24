import type { Metadata } from "next";
import { ForgotForm } from "./form";

export const metadata: Metadata = { title: "Reset your password" };
export default function Page() { return <ForgotForm />; }
