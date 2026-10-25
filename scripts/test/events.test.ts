import { describe, expect, it } from "vitest";
import { functionEventCandidates, loadWebSdk, realtimeCandidates } from "../lib/events-experiments";

describe("events experiment", () => {
  it("probes both the databases.* and vectorsdb.* namespaces", () => {
    const ch = realtimeCandidates("engram", "memories", "m_test0000_900000000001");
    expect(ch).toContain("databases.engram.collections.memories.documents");
    expect(ch).toContain("vectorsdb.engram.collections.memories.documents");
    const ev = functionEventCandidates("engram", "concepts");
    expect(ev).toContain("databases.engram.collections.concepts.documents.*.create");
    expect(ev).toContain("vectorsdb.engram.collections.concepts.documents.*.update");
  });

  it("loads the appwrite web SDK in Node with a window shim", async () => {
    const sdk = await loadWebSdk("https://engram.example");
    const client = new sdk.Client().setEndpoint("https://appwrite.invalid/v1").setProject("p").setJWT("j");
    expect(typeof client.subscribe).toBe("function");
    expect((globalThis.WebSocket as unknown as { __engram?: boolean }).__engram).toBe(true);
  });
});
