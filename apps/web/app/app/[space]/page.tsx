import { spaceTitle } from "./titles";
import { OverviewView } from "./view";

export const generateMetadata = spaceTitle("Overview");
export default function Page() {
  return <OverviewView />;
}
