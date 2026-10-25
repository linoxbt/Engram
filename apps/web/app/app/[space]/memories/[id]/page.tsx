import { spaceTitle } from "../../titles";
import { MemoriesView } from "../view";
import { MemoryDeepLink } from "./drawer";

export const generateMetadata = spaceTitle("Memory");

/** Deep link to a memory: the explorer renders underneath and the memory opens over it as a drawer. */
export default function Page() {
  return (
    <>
      <MemoriesView />
      <MemoryDeepLink />
    </>
  );
}
