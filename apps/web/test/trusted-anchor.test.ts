import { beforeEach, describe, expect, it } from "vitest";
import type { Report } from "@engram/core";
import { writeTrusted } from "@/lib/client/verify";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.assign(globalThis, {
    document: { cookie: "engram_consent=accepted" },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
});

const report = (over: Partial<Report>) => ({
  status: "valid", entries: 4, findings: [], mode: "standard",
  latestCheckpoint: { size: 4, root: "a".repeat(64), createdAt: "2026-10-20T00:00:00.000Z" },
  ...over,
} as unknown as Report);

describe("the rollback anchor is only written for a report whose signatures were checked", () => {
  it("a build with no pinned keys checks nothing, so nothing is anchored", () => {
    // A site built without NEXT_PUBLIC_CP_PUBLIC_KEYS would otherwise pin an attacker's own checkpoint.
    writeTrusted("sp000001", report({ signaturesChecked: false } as Partial<Report>));
    expect(store.get("engram.trusted.sp000001")).toBeUndefined();
  });

  it("an older cached report without the field counts as unchecked", () => {
    writeTrusted("sp000002", report({}));
    expect(store.get("engram.trusted.sp000002")).toBeUndefined();
  });

  it("a checked, valid report is anchored", () => {
    writeTrusted("sp000003", report({ signaturesChecked: true } as Partial<Report>));
    expect(JSON.parse(store.get("engram.trusted.sp000003")!)).toEqual({ size: 4, root: "a".repeat(64) });
  });

  it("a tampered report is never anchored, checked or not", () => {
    writeTrusted("sp000004", report({ status: "tampered", signaturesChecked: true } as Partial<Report>));
    expect(store.get("engram.trusted.sp000004")).toBeUndefined();
  });
});
