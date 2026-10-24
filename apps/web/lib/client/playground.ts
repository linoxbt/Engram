"use client";
/**
 * A real, tiny Engram chain built in the visitor's browser with the same core
 * code the server uses: salted content hashes, linked header hashes, a signed
 * Merkle checkpoint, the Tamper Lab attacks and the verifier.
 */
import {
  applyEntry, buildCheckpoint, buildMeta, contentHash, embHash, entryId, generateKeyPair, genesis, headerHash, initialDerived,
  patchMeta, quantize, randomSalt, runAttack, score, seqStr, signCheckpoint, verifySpace,
  type AttackId, type ChainEntry, type Checkpoint, type Header, type Report, type StateMap,
} from "@engram/core";

export const PLAY_SPACE = "demo2050";

export const PLAY_MEMORIES: { text: string; subject: string; at: string; supersedes?: number }[] = [
  { text: "Ada Okafor leads operations at Kestrel Foods.", subject: "customer:ada", at: "2026-10-19T09:00:00.000Z" },
  { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada", at: "2026-10-19T09:01:00.000Z" },
  { text: "Ada prefers email over phone calls.", subject: "customer:ada", at: "2026-10-19T09:02:00.000Z" },
  { text: "Ada downgraded from Pro to Basic on 22 October.", subject: "customer:ada", at: "2026-10-22T11:15:00.000Z", supersedes: 1 },
  { text: "Kestrel Foods paid invoice INV-204 on time.", subject: "customer:kestrel", at: "2026-10-22T14:10:00.000Z" },
];

function vec(seed: number) {
  const v = Array.from({ length: 8 }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233));
  const n = Math.hypot(...v);
  return quantize(v.map((x) => x / n));
}

export interface Playground { entries: ChainEntry[]; checkpoints: Checkpoint[]; publicKey: string }

export async function buildPlayground(): Promise<Playground> {
  const entries: ChainEntry[] = [];
  const state: StateMap = new Map();
  for (let seq = 0; seq < PLAY_MEMORIES.length; seq++) {
    const m = PLAY_MEMORIES[seq];
    const salt = randomSalt();
    const vector = vec(seq + 1);
    const h: Header = {
      v: "1", space: PLAY_SPACE, seq: seqStr(seq), prevHash: seq ? entries[seq - 1].metadata.hash : await genesis(PLAY_SPACE),
      op: "remember", kind: "fact", agent: "a_demo2050_agent1", subject: m.subject,
      contentHash: await contentHash(salt, m.text), embHash: await embHash(vector), model: "nomic-embed-text",
      importance: score(6), confidence: score(8), source: null, validFrom: m.at, createdAt: m.at,
      refs: { supersedes: m.supersedes != null ? [entryId(PLAY_SPACE, m.supersedes)] : [], contradicts: [], related: [], target: null, derivedFrom: [] },
    };
    const id = entryId(PLAY_SPACE, seq);
    entries.push({ $id: id, metadata: buildMeta({ h, hash: await headerHash(h), c: { text: m.text, salt }, d: initialDerived("remember") }), vector });
    for (const cid of applyEntry(state, id, h)) {
      const e = entries.find((x) => x.$id === cid)!;
      const st = state.get(cid)!;
      e.metadata = patchMeta(e.metadata, { ...st, contradictedBy: [...st.contradictedBy] });
    }
  }
  const keys = await generateKeyPair();
  // Two seals, like a real space checkpointing as it grows: after #2 and at the head.
  const hashes = entries.map((e) => e.metadata.hash);
  const first = await signCheckpoint(await buildCheckpoint({ space: PLAY_SPACE, hashes: hashes.slice(0, 3), prev: null, keyId: "landing" }), keys.privateKey);
  const head = await signCheckpoint(await buildCheckpoint({ space: PLAY_SPACE, hashes, prev: first, keyId: "landing" }), keys.privateKey);
  return { entries, checkpoints: [first, head], publicKey: keys.publicKey };
}

export const verifyPlayground = (p: Playground, entries: ChainEntry[]): Promise<Report> =>
  verifySpace({ space: PLAY_SPACE, entries, checkpoints: p.checkpoints, publicKeyHex: p.publicKey });

export async function attackPlayground(p: Playground, id: AttackId, seq: number, text: string) {
  return runAttack(id, p.entries, { seq, text });
}

/** A visitor typed into memory #seq: change the stored text and its searchable copy, nothing else. */
export function editText(entries: ChainEntry[], seq: number, text: string): ChainEntry[] {
  const es = structuredClone(entries);
  es[seq].metadata = { ...es[seq].metadata, c: { ...es[seq].metadata.c, text }, text };
  return es;
}
