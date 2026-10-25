import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalBackend, createSpace, setConfig, type Backend, type SpaceInfo } from "@engram/server";
import { labelDue } from "../src/due";

const state = vi.hoisted(() => ({ b: null as unknown }));
vi.mock("../../shared", async (orig) => ({ ...(await orig<typeof import("../../shared")>()), boot: () => state.b }));
const { default: handler } = await import("../src/main");

describe("labelDue", () => {
  it("is due only at a threshold the concept has reached and not been labelled at", () => {
    expect(labelDue({ membersN: 1, labeledAtMembers: "00000000" })).toBeNull();
    expect(labelDue({ membersN: 2, labeledAtMembers: "00000000" })).toBeNull();
    expect(labelDue({ membersN: 3, labeledAtMembers: "00000000" })).toBe(3);
    expect(labelDue({ members: "00000004", labeledAtMembers: "00000003" })).toBeNull();
    expect(labelDue({ membersN: 12, labeledAtMembers: "00000003" })).toBe(10);
    expect(labelDue({ membersN: 31, labeledAtMembers: "00000000" })).toBe(30);
    expect(labelDue({ membersN: 3 })).toBe(3);
    expect(labelDue(null)).toBeNull();
    expect(labelDue({ members: "lots" })).toBeNull();
  });
});

describe("labeler Function", () => {
  let b: Backend, space: SpaceInfo;
  const concept = (key: string) => `c_${key}_abcdef`;
  const run = async (payload: unknown, headers: Record<string, string> = {}) => {
    let out: { data: unknown; status: number } = { data: null, status: 0 };
    const logs: string[] = [];
    await handler({ req: { bodyText: JSON.stringify(payload), headers }, res: { json: (data, status = 200) => (out = { data, status }), text: (s) => s }, log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) });
    return { ...(out as { data: Record<string, unknown>; status: number }), logs };
  };

  beforeEach(async () => {
    setConfig({ backend: "local", classifierModel: null });
    b = createLocalBackend({ dir: null });
    state.b = b;
    space = await createSpace(b, { name: "Labels", ownerId: "" });
    await b.vectors.create("concepts", concept(space.key), { embeddings: [1, 0], metadata: { space: space.key, label: "old", summary: "", members: "00000003", membersN: 3, labeledAtMembers: "00000000" } }, []);
    for (let i = 0; i < 3; i++) {
      await b.vectors.create("memories", `m_${space.key}_${String(i).padStart(12, "0")}`, { embeddings: [1, 0], metadata: { space: space.key, status: "active", c: { text: `Kestrel Foods invoice question ${i}` }, d: { concept: concept(space.key) } } }, []);
    }
  });
  afterEach(() => vi.useRealTimers());

  it("skips a create event for a one-member concept without touching storage", async () => {
    const get = vi.spyOn(b.vectors, "get");
    const r = await run({ $id: concept(space.key), $collectionId: "concepts", metadata: { space: space.key, membersN: 1, labeledAtMembers: "00000000" } }, { "x-appwrite-trigger": "event", "x-appwrite-event": "vectorsdb.engram.collections.concepts.documents.x.create" });
    expect(r.data).toEqual({ ok: true, skipped: true });
    expect(get).not.toHaveBeenCalled();
    expect(r.logs.join()).toContain("no member threshold due");
  });

  it("labels a due concept on an update event after the grace period, and the follow-up event finds nothing due", async () => {
    vi.useFakeTimers();
    const p = run({ $id: concept(space.key), $collectionId: "concepts", metadata: { space: space.key, membersN: 3, labeledAtMembers: "00000000" } }, { "x-appwrite-trigger": "event" });
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.data.ok).toBe(true);
    const after = (await b.vectors.get<{ label: string; labeledAtMembers: string }>("concepts", concept(space.key)))!.metadata;
    expect(after.labeledAtMembers).toBe("00000003");
    expect(after.label).not.toBe("old");
    const again = await run({ $id: concept(space.key), $collectionId: "concepts", metadata: { space: space.key, ...after, membersN: 3 } }, { "x-appwrite-trigger": "event" });
    expect(again.data).toEqual({ ok: true, skipped: true });
  });

  it("skips when the app labelled the concept during the grace period", async () => {
    vi.useFakeTimers();
    const p = run({ $id: concept(space.key), $collectionId: "concepts", metadata: { space: space.key, membersN: 3, labeledAtMembers: "00000000" } }, { "x-appwrite-trigger": "event" });
    const c = (await b.vectors.get<Record<string, unknown>>("concepts", concept(space.key)))!;
    await b.vectors.update("concepts", c.$id, { metadata: { ...c.metadata, labeledAtMembers: "00000003" } });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await p).data).toEqual({ ok: true, skipped: true });
  });

  it("an HTTP call labels unconditionally; events from other collections are ignored", async () => {
    const r = await run({ space: space.key, concept: concept(space.key) });
    expect(r.data.ok).toBe(true);
    expect((await run({ $id: "x", $collectionId: "memories", metadata: { space: space.key } }, { "x-appwrite-trigger": "event" })).data).toEqual({ ok: true, skipped: true });
  });
});
