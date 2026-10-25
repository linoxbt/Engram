import { spaceTitle } from "../titles";
import { MemoriesView } from "./view";

export const generateMetadata = spaceTitle("Memories");
export default function Page() {
  return <MemoriesView />;
}
