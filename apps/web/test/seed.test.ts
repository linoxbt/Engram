import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/client/api";
import { finishSeeding, isSeeding, SeedIncomplete, type SeedState } from "@/lib/client/seed";

const noSleep = async () => {};

/** A fake seed route: `script` decides what each call returns or throws. */
function server(script: ((call: number) => SeedState | Error)[]) {
  let call = 0;
  const post = async () => {
    const step = script[Math.min(call, script.length - 1)](call);
    call++;
    if (step instanceof Error) throw step;
    return step;
  };
  return { post, calls: () => call };
}
const at = (done: number, total = 4): SeedState => ({ done: done >= total, progress: { done, total } });

describe("finishSeeding", () => {
  it("does nothing when no story was started", async () => {
    const s = server([() => at(4)]);
    expect(await finishSeeding("aaaaaaaa", null, { post: s.post })).toBeNull();
    expect(s.calls()).toBe(0);
  });

  it("retries a failed slice with backoff and resumes", async () => {
    const waits: number[] = [];
    const s = server([() => at(2), () => new ApiError(503, "unavailable", "busy"), () => new TypeError("fetch failed"), () => at(4)]);
    const seen: number[] = [];
    const p = await finishSeeding("aaaaaaaa", at(1), { post: s.post, sleep: async (ms) => { waits.push(ms); }, onProgress: (x) => seen.push(x.done) });
    expect(p).toEqual({ done: 4, total: 4 });
    expect(waits).toEqual([1000, 2000]);
    expect(seen).toEqual([1, 2, 4]);
    expect(isSeeding("aaaaaaaa")).toBe(false);
  });

  it("reports clearly when the story cannot be finished, keeping the progress", async () => {
    const s = server([() => at(2), () => new ApiError(500, "error", "boom")]);
    const err = await finishSeeding("bbbbbbbb", at(1), { post: s.post, sleep: noSleep, attempts: 3 }).catch((e) => e);
    expect(err).toBeInstanceOf(SeedIncomplete);
    expect(err.progress).toEqual({ done: 2, total: 4 });
    expect(err.message).toMatch(/stopped at 2\/4: boom/);
    expect(s.calls()).toBe(4); // one success, then three attempts
  });

  it("does not retry a refusal", async () => {
    const s = server([() => new ApiError(403, "forbidden", "Only the owner")]);
    await expect(finishSeeding("cccccccc", at(0), { post: s.post, sleep: noSleep })).rejects.toThrow(/Only the owner/);
    expect(s.calls()).toBe(1);
  });

  it("never returns silently when the server stops making progress", async () => {
    const s = server([() => at(2)]);
    await expect(finishSeeding("dddddddd", at(1), { post: s.post, sleep: noSleep, stallLimit: 3 })).rejects.toThrow(/stopped making progress/);
  });

  it("refuses to drive the same space twice at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = finishSeeding("eeeeeeee", at(0), { post: async () => { await gate; return at(4); } });
    await expect(finishSeeding("eeeeeeee", at(0), { post: async () => at(4) })).rejects.toThrow(/already running/);
    release();
    await first;
  });
});
