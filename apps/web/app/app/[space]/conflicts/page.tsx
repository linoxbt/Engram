import { spaceTitle } from "../titles";
import { ConflictsView } from "./view";

export const generateMetadata = spaceTitle("Conflicts");
export default function Page() {
  return <ConflictsView />;
}
