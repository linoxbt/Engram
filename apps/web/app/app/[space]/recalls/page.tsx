import { spaceTitle } from "../titles";
import { RecallsView } from "./view";

export const generateMetadata = spaceTitle("Recall audit");
export default function Page() {
  return <RecallsView />;
}
