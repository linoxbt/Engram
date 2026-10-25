import { describe, expect, it } from "vitest";
import { verifySpace, type Report } from "@engram/core";
import { caughtBy, LAYER, reportHeadline, staleBy, warningReason } from "@/lib/client/report-copy";
import { SPACE, TestChain, checkpointAt, keys } from "../../../packages/core/test/helpers";

const base: Report = { space: SPACE, entries: 5, validThrough: 4, checkpointsValid: 1, checkpointsTotal: 1, latestCheckpoint: null, findings: [], status: "valid", checkedAt: "2026-10-25T00:00:00.000Z", mode: "public" };

describe("report headlines", () => {
  it("never calls a warning verified, and names the warning", async () => {
    const c = new TestChain();
    for (let i = 0; i < 4; i++) await c.add({});
    const k = await keys();
    const cp = await checkpointAt(c.entries, 4, k.privateKey, null);
    // No key given: hashes verify but signatures are not checked.
    const r = await verifySpace({ space: SPACE, entries: c.entries, checkpoints: [cp] });
    expect(r.status).toBe("warning");
    const h = reportHeadline(r);
    expect(h.tone).toBe("warning");
    expect(h.text).toBe("Hashes verify through #3; signatures not independently checked.");
    expect(h.text).not.toMatch(/^Verified/);
  });

  it("is green only for a clean report", () => {
    expect(reportHeadline(base)).toEqual({ tone: "valid", text: "Verified through #4." });
  });

  it("describes derived mismatches and pending erasures", () => {
    expect(warningReason([{ rule: "derived", message: "x" }])).toBe("derived fields disagree with the chain");
    expect(warningReason([{ rule: "content", message: "Memory #3 is being forgotten; its erasure has not finished yet." }])).toBe("an erasure is still finishing");
    expect(warningReason([{ rule: "time", message: "x" }, { rule: "time", message: "y" }])).toBe("2 warnings");
  });

  it("reports the first critical finding for tampering", () => {
    const r: Report = { ...base, status: "tampered", validThrough: 1, findings: [{ seq: 2, rule: "content", severity: "critical", message: "m" }] };
    expect(reportHeadline(r)).toEqual({ tone: "tampered", text: "Memory #2 was changed after it was written." });
    const t: Report = { ...base, status: "tampered", findings: [{ seq: 5, rule: "truncation", severity: "critical", message: "Three memories are missing." }] };
    expect(reportHeadline(t).text).toBe("Three memories are missing.");
  });
});

describe("Tamper Lab: the defence that fired comes from the findings", () => {
  it("maps the first critical finding to its layer", () => {
    const r: Report = { ...base, status: "tampered", findings: [
      { seq: 1, rule: "copy", severity: "warning", message: "copy" },
      { seq: 3, rule: "checkpoint", severity: "critical", message: "Entries #0–#3 no longer match" },
    ] };
    const c = caughtBy(r)!;
    expect(c.layer).toBe(LAYER.checkpoint);
    expect(c.finding.message).toMatch(/no longer match/);
  });
  it("falls back to warnings, and to nothing", () => {
    expect(caughtBy({ ...base, status: "warning", findings: [{ seq: 1, rule: "derived", severity: "warning", message: "d" }] })!.layer).toBe("Chain replay");
    expect(caughtBy(base)).toBeNull();
  });
});

describe("integrity staleness", () => {
  it("counts entries written after the stored check", () => {
    expect(staleBy({ entries: 40 }, 43)).toBe(3);
    expect(staleBy({ entries: 40 }, 40)).toBe(0);
    expect(staleBy(null, 43)).toBe(0);
    expect(staleBy({ entries: 40 }, undefined)).toBe(0);
  });
});
