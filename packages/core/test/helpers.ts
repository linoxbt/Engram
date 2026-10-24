import {
  buildMeta, contentHash, embHash, entryId, genesis, headerHash, initialDerived, quantize, randomSalt, score, seqStr,
  tombstoneVector, applyEntry, patchMeta, buildCheckpoint, signCheckpoint, generateKeyPair,
  type ChainEntry, type Checkpoint, type EntryKind, type Header, type Op, type Refs, type StateMap,
} from "../src/index";

export const SPACE = "k7m2q9xa";
export const DIM = 16;

export function vec(seed: number): number[] {
  const v = Array.from({ length: DIM }, (_, i) => Math.sin(seed * 13.37 + i * 1.7));
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return quantize(v.map((x) => x / n));
}

export interface Spec {
  op?: Op; kind?: EntryKind; text?: string | null; subject?: string | null; agent?: string;
  refs?: Partial<Refs>; at?: string; vector?: number[];
}

/** Builds a valid chain in memory, applying derived updates exactly like the write path. */
export class TestChain {
  entries: ChainEntry[] = [];
  state: StateMap = new Map();
  private t = Date.parse("2026-10-19T09:00:00.000Z");

  async add(s: Spec): Promise<ChainEntry> {
    const seq = this.entries.length;
    const op = s.op ?? "remember";
    const prev = this.entries[seq - 1];
    const prevHash = prev ? prev.metadata.hash : await genesis(SPACE);
    this.t += 60_000;
    const createdAt = s.at ?? new Date(this.t).toISOString();
    const salt = randomSalt();
    const text = s.text === undefined ? (op === "remember" ? `memory ${seq}` : null) : s.text;
    const vector = s.vector ?? (op === "remember" || op === "reflect" ? vec(seq + 1) : tombstoneVector(DIM));
    const h: Header = {
      v: "1", space: SPACE, seq: seqStr(seq), prevHash, op, kind: s.kind ?? (op === "forget" ? "tombstone" : "fact"),
      agent: s.agent ?? "a_k7m2q9xa_sup001", subject: s.subject ?? null,
      contentHash: await contentHash(salt, text ?? ""), embHash: await embHash(vector), model: "test",
      importance: score(5), confidence: score(7), source: null, validFrom: createdAt, createdAt,
      refs: { supersedes: [], contradicts: [], related: [], target: null, derivedFrom: [], ...s.refs },
    };
    const hash = await headerHash(h);
    const id = entryId(SPACE, seq);
    const entry: ChainEntry = {
      $id: id,
      metadata: buildMeta({ h, hash, c: { text, salt: text == null ? null : salt }, d: initialDerived(op) }),
      vector,
    };
    this.entries.push(entry);
    const changed = applyEntry(this.state, id, h);
    for (const cid of changed) {
      const e = this.entries.find((x) => x.$id === cid)!;
      const st = this.state.get(cid)!;
      const forgotten = st.status === "forgotten";
      e.metadata = patchMeta(e.metadata, { ...st, contradictedBy: [...st.contradictedBy] }, forgotten ? { text: null, salt: null } : undefined);
      if (forgotten) e.vector = tombstoneVector(DIM);
    }
    return entry;
  }

  id(seq: number) { return entryId(SPACE, seq); }
  clone(): ChainEntry[] { return structuredClone(this.entries); }
}

export async function keys() { return generateKeyPair(); }

export async function checkpointAt(entries: ChainEntry[], n: number, priv: string, prev: Checkpoint | null): Promise<Checkpoint> {
  const unsigned = await buildCheckpoint({ space: SPACE, hashes: entries.slice(0, n).map((e) => e.metadata.hash), prev, keyId: "test" });
  return signCheckpoint(unsigned, priv);
}
