import { spaceTitle } from "../titles";
import { TimeMachineView } from "./view";

export const generateMetadata = spaceTitle("Time Machine");
export default function Page() {
  return <TimeMachineView />;
}
