/**
 * Regression tests for the second external audit. Each one reproduces a defect that let a hostile server, or a
 * plain mistake, pass verification; each failed before the fix in the same commit.
 */
import { describe, expect, it } from "vitest";
import { embHash, isTombstone, quantize, tombstoneVector } from "../src/index";
import { vec } from "./helpers";

describe("A2 embHash cannot be made to collide by Int32 wraparound", () => {
  it("refuses components outside the unit range instead of hashing them mod 2^32", async () => {
    const v = [0.1, -0.2, 0.3, 0.4];
    const PERIOD = 2 ** 32 / 1e5; // 42949.67296
    const wrapped = [v[0] + PERIOD, v[1] + 2 * PERIOD, v[2] + PERIOD, v[3] + 2 * PERIOD];
    await expect(embHash(wrapped)).rejects.toThrow(/out of range/);
    expect(await embHash(v)).toBe("9c3e522fa628632ae956714374be3712b1620792d0474f0ec8398291aa5f6305");
  });

  it("hashes every legitimate vector exactly as before", async () => {
    // Golden hexes recorded before the change: a stored chain must keep verifying.
    expect(await embHash(tombstoneVector(16))).toBe("7daf115c9a1aff154ad369d4546ae0b86522216b7d008b3d027597fb191b5514");
    expect(await embHash(tombstoneVector(768))).toBe("f6610f6ef36f80ff372473844bc22e9eeaab2a124503a94e3b1f05952fcee256");
    expect(await embHash([])).toBe("e9d0a8a3d3318b78689b348af9fe18bd9396db51381c140ca078898380ce2f65");
    expect(await embHash(quantize([1, -1, 0.5, -0.000004]))).toBe("4e31571298a59509c6ab5cfe1c081bf4b9a074a7ad819c63a19e5f8d9d7a5869");
    expect(await embHash(vec(1))).toBe("6fcd0005c13a49b4cbd02a85a384fb95e70214a9d247d2276dad40296dac5e5c");
    expect(await embHash(vec(5))).toBe("46c8483f12c5d689ed1274c0f64e9f845bd6bfcd6051e73c4b23d299cf800204");
    expect(await embHash(vec(3), "saltysalt")).toBe("e497b0ae4b464f2af063da8ae9de55dca102317432ad72abf21521024a9aba5b");
  });
});
describe("A3 NaN is not a tombstone", () => {
  it("rejects a vector of NaN and refuses to hash it", async () => {
    const nan = new Array(16).fill(NaN);
    expect(isTombstone(nan)).toBe(false);
    expect(isTombstone([NaN, 0, 0])).toBe(false);
    await expect(embHash(nan)).rejects.toThrow(/out of range/);
    expect(isTombstone(tombstoneVector(16))).toBe(true);
  });
});
