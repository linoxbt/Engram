import { spaceTitle } from "../titles";
import { SettingsView } from "./view";

export const generateMetadata = spaceTitle("Settings");
export default function Page() {
  return <SettingsView />;
}
