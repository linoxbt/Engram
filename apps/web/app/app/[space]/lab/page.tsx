import { spaceTitle } from "../titles";
import { LabView } from "./view";

export const generateMetadata = spaceTitle("Tamper Lab");
export default function Page() {
  return <LabView />;
}
