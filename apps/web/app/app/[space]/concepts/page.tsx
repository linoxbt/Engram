import { spaceTitle } from "../titles";
import { ConceptsView } from "./view";

export const generateMetadata = spaceTitle("Concept map");
export default function Page() {
  return <ConceptsView />;
}
