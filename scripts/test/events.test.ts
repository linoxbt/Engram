import { describe, expect, it } from "vitest";
import { functionEventCandidates, functionEventVerdict, loadWebSdk, realtimeCandidates } from "../lib/events-experiments";

describe("events experiment", () => {
  it("probes both the databases.* and vectorsdb.* namespaces", () => {
    const ch = realtimeCandidates("engram", "memories", "m_test0000_900000000001");
    expect(ch).toContain("databases.engram.collections.memories.documents");
    expect(ch).toContain("vectorsdb.engram.collections.memories.documents");
    const ev = functionEventCandidates("engram", "concepts");
    expect(ev).toContain("databases.engram.collections.concepts.documents.*.create");
    expect(ev).toContain("vectorsdb.engram.collections.concepts.documents.*.update");
  });

  it("only claims a namespace when an execution actually logged one", () => {
    const named = functionEventVerdict([{ id: "e1", event: "vectorsdb.engram.collections.concepts.documents.c_test0000_ab12cd.update", status: "completed" }]);
    expect(named.ok).toBe(true);
    expect(named.names).toHaveLength(1);
    expect(named.action).toContain("vectorsdb.engram.collections.concepts.documents.*.update");

    // Executions fired, but Appwrite logged no x-appwrite-event header: that is not a verified namespace.
    const blind = functionEventVerdict([{ id: "e1", event: null, status: "completed" }, { id: "e2", event: null, status: "completed" }]);
    expect(blind.ok).toBeNull();
    expect(blind.names).toEqual([]);
    expect(blind.action).toContain("unproven");
    expect(blind.action).not.toContain("e1");

    const none = functionEventVerdict([]);
    expect(none.ok).toBe(false);
    expect(none.action).toContain("inline");
  });

  it("loads the appwrite web SDK in Node with a window shim", async () => {
    const sdk = await loadWebSdk("https://engram.example");
    const client = new sdk.Client().setEndpoint("https://appwrite.invalid/v1").setProject("p").setJWT("j");
    expect(typeof client.subscribe).toBe("function");
    expect((globalThis.WebSocket as unknown as { __engram?: boolean }).__engram).toBe(true);
  });
});
