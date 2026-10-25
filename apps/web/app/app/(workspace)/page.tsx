import type { Metadata } from "next";
import { SpacesPage } from "./spaces-page";

export const metadata: Metadata = { title: "Spaces" };
export default function Page() {
  return <SpacesPage />;
}
