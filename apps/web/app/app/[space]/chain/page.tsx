import { spaceTitle } from "../titles";
import { ChainView } from "./view";

export const generateMetadata = spaceTitle("Chain & verifier");
export default function Page() {
  return <ChainView />;
}
