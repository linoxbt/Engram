import { spaceTitle } from "../titles";
import { AgentsView } from "./view";

export const generateMetadata = spaceTitle("Agents");
export default function Page() {
  return <AgentsView />;
}
