/**
 * Signed Merkle checkpoints in Storage. The signing key lives only where
 * checkpoints are made (the checkpoint Function, or the app when no Function
 * is configured); verifiers need only the public key.
 *
 * Files per space (all in the checkpoints bucket):
 *   cp_<space>_<seq>          the signed checkpoint
 *   cpl_<space>_<seq|genesis>     run lock for extending that checkpoint (reclaimable when stale)
 *   cpl_<space>_<seq|genesis>_c   successor claim: the one checkpoint that extends it (create-first, never reclaimed)
 *   cpl_<space>_<seq>_f       unsigned Merkle frontier of that checkpoint, for incremental signing
 * Everything but cp_* shares the cpl_ prefix, so purging a space removes it with the locks.
 */
import {
  ChainVerifier, buildCheckpoint, checkpointFileId, checkpointHash, checkpointProblem, cpSize, entryId, frontierAppendHex,
  frontierRootHex, headerHash, headerProblem, iso, popcount, publicKeyFromPrivate, randomSalt, seqOf, seqStr, signCheckpoint, toBase64,
  verifyCheckpointSig, verifySpace, type Anchor, type ChainEntry, type Checkpoint, type EntryMeta, type Report,
} from "@engram/core";
import type { Backend, FileInfo } from "./backend/types";
import { chainHead, loadChain } from "./chain";
import { getConfig, keyringOf, type EngramConfig } from "./config";
import type { Ctx, SpaceInfo } from "./context";
import { isConflict } from "./errors";
import type { IntegrityStatus } from "./settings";
import { getSpace, updateSettings } from "./spaces";
import { integrityOf, recordIntegrity, verifyStoredSpace } from "./verify";

const dec = new TextDecoder();
const enc = new TextEncoder();

export interface MalformedCheckpoint { fileId: string; raw: unknown; problem: string }
type Parsed = { cp: Checkpoint } | { bad: MalformedCheckpoint };

/**
 * Parsed files by ID. Files are create-only, so a hit is reused while the listing still shows the same creation time
 * and size; a file deleted and recreated under the same ID (which changes both) is downloaded again. Files this
 * process wrote itself are not cached (the write does not return a stamp), so a replacement is never masked.
 */
const fileCache = new Map<string, { stamp: string; parsed: Parsed }>();
const stampOf = (f: FileInfo) => `${f.createdAt}|${f.size}`;

function parseCheckpoint(fileId: string, bytes: Uint8Array, spaceKey: string): Parsed {
  let raw: unknown;
  try { raw = JSON.parse(dec.decode(bytes)); } catch { return { bad: { fileId, raw: null, problem: "not JSON" } }; }
  const problem = checkpointProblem(raw, spaceKey);
  return problem ? { bad: { fileId, raw, problem } } : { cp: raw as Checkpoint };
}

async function readFile(b: Backend, bucket: string, f: FileInfo, spaceKey: string): Promise<Parsed | null> {
  const hit = fileCache.get(f.fileId);
  if (hit && hit.stamp === stampOf(f)) return hit.parsed;
  const bytes = await b.files.get(bucket, f.fileId);
  if (!bytes) return null;
  const parsed = parseCheckpoint(f.fileId, bytes, spaceKey);
  if ("cp" in parsed) fileCache.set(f.fileId, { stamp: stampOf(f), parsed });
  return parsed;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const listCheckpointFiles = async (b: Backend, bucket: string, spaceKey: string) =>
  (await b.files.list(bucket, `cp_${spaceKey}_`)).filter((f) => f.fileId.startsWith(`cp_${spaceKey}_`));

/**
 * Every checkpoint file of a space, for verification: well-formed checkpoints sorted by size, and malformed files
 * as raw objects so the verifier reports them (dropping them would hide tampering). Only files not already parsed
 * by this process are downloaded, a few at a time.
 */
export async function loadCheckpointFiles(b: Backend, spaceKey: string): Promise<{ checkpoints: Checkpoint[]; malformed: MalformedCheckpoint[] }> {
  const bucket = getConfig().appwrite.checkpointsBucket;
  const files = await listCheckpointFiles(b, bucket, spaceKey);
  const parsed = await mapLimit(files, 8, (f) => readFile(b, bucket, f, spaceKey));
  const checkpoints: Checkpoint[] = [];
  const malformed: MalformedCheckpoint[] = [];
  for (const p of parsed) {
    if (!p) continue;
    if ("cp" in p) checkpoints.push(p.cp);
    else malformed.push(p.bad);
  }
  return { checkpoints: checkpoints.sort((a, b) => cpSize(a) - cpSize(b)), malformed };
}

/** Well-formed checkpoints only (API listings, exports). Verification uses loadCheckpointFiles. */
export async function loadCheckpoints(b: Backend, spaceKey: string): Promise<Checkpoint[]> {
  return (await loadCheckpointFiles(b, spaceKey)).checkpoints;
}

/** Newest first, stopping at the first well-formed checkpoint whose ID matches its content; files skipped on the way are reported. */
async function scanNewest(b: Backend, spaceKey: string): Promise<{ cp: Checkpoint | null; skipped: MalformedCheckpoint[] }> {
  const bucket = getConfig().appwrite.checkpointsBucket;
  const files = (await listCheckpointFiles(b, bucket, spaceKey)).sort((x, y) => (x.fileId < y.fileId ? 1 : -1));
  const skipped: MalformedCheckpoint[] = [];
  for (const f of files) {
    const p = await readFile(b, bucket, f, spaceKey);
    if (!p) continue;
    if ("cp" in p && checkpointFileId(p.cp) === f.fileId) return { cp: p.cp, skipped };
    skipped.push("bad" in p ? p.bad : { fileId: f.fileId, raw: p.cp, problem: "its name does not match its contents" });
  }
  return { cp: null, skipped };
}

/** Downloads only the newest file: IDs embed the zero-padded seq, so ID order is size order. */
export async function latestCheckpoint(b: Backend, spaceKey: string): Promise<Checkpoint | null> {
  return (await scanNewest(b, spaceKey)).cp;
}

/** Entries with seq in [from, to), in order, without paging through the prefix. */
export async function loadChainRange(b: Backend, spaceKey: string, from: number, to: number): Promise<ChainEntry[]> {
  const out: ChainEntry[] = [];
  let cursor: string | undefined;
  while (out.length < to - from) {
    const docs = await b.vectors.query<EntryMeta>("memories", {
      filters: [{ op: "eq", path: "metadata.space", values: [spaceKey] }, { op: "gte", path: "metadata.seq", value: seqStr(from) }],
      order: { field: "$id", dir: "asc" }, limit: 500, cursorAfter: cursor, withVectors: false,
    });
    for (const d of docs) if (seqOf(d.$id) < to) out.push({ $id: d.$id, metadata: d.metadata });
    if (docs.length < 500 || seqOf(docs[docs.length - 1].$id) >= to - 1) break;
    cursor = docs[docs.length - 1].$id;
  }
  return out;
}

interface FrontierFile { v: "1"; space: string; size: string; root: string; frontier: string[] }
const frontierId = (space: string, seq: string) => `cpl_${space}_${seq}_f`;

/** The frontier stored beside `cp`, accepted only if it recomputes the signed root. */
async function readFrontier(b: Backend, bucket: string, cp: Checkpoint): Promise<string[] | null> {
  const bytes = await b.files.get(bucket, frontierId(cp.space, cp.seq)).catch(() => null);
  if (!bytes) return null;
  try {
    const f = JSON.parse(dec.decode(bytes)) as FrontierFile;
    if (f.size !== cp.size || !Array.isArray(f.frontier) || f.frontier.length !== popcount(cpSize(cp))) return null;
    if (!f.frontier.every((h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h))) return null;
    return (await frontierRootHex(f.frontier)) === cp.root ? f.frontier : null;
  } catch {
    return null;
  }
}

export interface CheckpointRun {
  created: boolean;
  reason?: string;
  checkpoint?: Checkpoint;
  /** The signer declined for an integrity or key problem (not merely "nothing to do"). */
  refused?: boolean;
}

/**
 * The signer's keyring: every configured key plus its own public key, so it can always check what it signed itself.
 * A configured key for its keyId that differs from its own key is a misconfiguration, never silently overridden.
 */
async function signerKeyring(cfg: EngramConfig, privateKey: string, keyId: string): Promise<Record<string, string> | string> {
  const ring = keyringOf(cfg);
  const own = await publicKeyFromPrivate(privateKey);
  if (ring[keyId] && ring[keyId] !== own) return `CP_PRIVATE_KEY does not match the public key configured for ${keyId}. Checkpoints signed now would not verify.`;
  ring[keyId] = own;
  return ring;
}

const tamperedStatus = (message: string, entries: number, validThrough: number): IntegrityStatus => ({
  status: "tampered", validThrough, entries, findings: 1, critical: 1, checkedAt: iso(), firstFinding: message,
});

/**
 * Sign a checkpoint over every entry so far. The signer is the trust anchor, so it refuses (recording the space as
 * tampered and alerting the owner) whenever what is stored disagrees with what it signed before:
 *  - settings.latestCheckpoint (team prefs, which database and storage access cannot edit) names the newest
 *    checkpoint it signed; stored checkpoints that are missing, older or different mean files were deleted or replaced;
 *  - a malformed checkpoint file, an invalid signature on the previous checkpoint, or new entries that do not verify;
 *  - the space's recorded integrity is "tampered": then it first runs the same full verification as the sentinel
 *    (every checkpoint file, malformed ones included, and the trust anchor), records the result, and signs only if
 *    that passes. This catches problems inside signed history and in older files, which incremental signing skips.
 * It also refuses, without blaming the data, when it cannot check the previous checkpoint's signature (fail closed).
 *
 * Incremental signing (soundness): the previous checkpoint P is accepted only after its signature verifies with the
 * keyring and it matches the trust anchor. Its root commits to the leaves of entries 0..P.size-1. The stored frontier
 * is unsigned but is used only if it recomputes P.root, so (by collision resistance) it is the compact range of exactly
 * those signed leaves. New entries are verified from P on: the stored entry P.size-1 must still hash to P.head and each
 * new entry must link to its predecessor. The new root is the frontier extended with the new leaves, so the new
 * checkpoint certifies P's history unchanged plus entries that verify, and nothing the signer did not check.
 * Tampering inside P's range cannot enter a signature this way; the sentinel's full verification reports it.
 * Without a usable frontier (first checkpoint, older checkpoints) the whole chain is verified and hashed.
 */
export async function runCheckpoint(b: Backend, space: SpaceInfo, opts: { privateKey: string; keyId?: string; cfg?: EngramConfig; force?: boolean }): Promise<CheckpointRun> {
  const cfg = opts.cfg ?? getConfig();
  const head = await chainHead(b, space.key);
  if (!head) return { created: false, reason: "empty chain" };
  const size = seqOf(head.$id) + 1;
  const trusted = space.settings.latestCheckpoint;
  // Cheap exit for scheduled runs: settings record the latest checkpoint, so an idle space costs no file reads.
  if (!opts.force && trusted?.size === size) return { created: false, reason: "no new entries" };
  if (space.settings.integrity?.status === "tampered") {
    const report = await verifyStoredSpace(b, space);
    await recordIntegrity(b, space, integrityOf(report)).catch((e) => console.error("[engram] could not record integrity", e));
    if (report.status === "tampered") {
      const first = report.findings.find((f) => f.severity === "critical")?.message ?? "see the chain page";
      return { created: false, refused: true, reason: `refusing to sign: the chain does not verify (${first})` };
    }
  }
  const keyId = opts.keyId ?? cfg.checkpoint.keyId;
  const ring = await signerKeyring(cfg, opts.privateKey, keyId);
  if (typeof ring === "string") { console.error(`[engram] checkpoint signer misconfigured: ${ring}`); return { created: false, refused: true, reason: `refusing to sign: ${ring}` }; }

  const refuse = async (message: string, report?: Report): Promise<CheckpointRun> => {
    const integrity = report ? integrityOf(report) : tamperedStatus(message, size, -1);
    await recordIntegrity(b, space, integrity).catch((e) => console.error("[engram] could not record integrity", e));
    console.error(`[engram] checkpoint signer refused for ${space.key}: ${message}`);
    return { created: false, refused: true, reason: `refusing to sign: ${message}` };
  };

  const { cp: prev, skipped } = await scanNewest(b, space.key);
  if (skipped.length) return refuse(`Checkpoint file ${skipped[0].fileId} is malformed (${skipped[0].problem}). It was altered outside Engram.`);
  if (prev && cpSize(prev) >= size) return { created: false, reason: "no new entries" };
  if (trusted) {
    if (!prev || cpSize(prev) < trusted.size) {
      return refuse(`This space's signer last signed ${trusted.size} entries (${trusted.fileId}), but the newest stored checkpoint ${prev ? `covers only ${cpSize(prev)}` : "is gone"}. Checkpoint files were deleted or rolled back.`);
    }
    if (cpSize(prev) === trusted.size && (prev.root !== trusted.root || checkpointFileId(prev) !== trusted.fileId)) {
      return refuse(`Checkpoint ${checkpointFileId(prev)} is not the one this space's signer recorded. It was replaced outside Engram.`);
    }
  }
  if (prev) {
    const key = ring[prev.keyId];
    if (!key) {
      const msg = `checkpoint ${checkpointFileId(prev)} is signed with key ${prev.keyId}, which is not in CP_PUBLIC_KEYS. Add every key ever used (see docs/key-rotation.md).`;
      console.error(`[engram] checkpoint signer cannot verify its predecessor: ${msg}`);
      return { created: false, refused: true, reason: `refusing to sign: ${msg}` };
    }
    if (!(await verifyCheckpointSig(prev, key))) return refuse(`Checkpoint ${checkpointFileId(prev)} has an invalid signature.`);
  }

  // One successor per checkpoint. The lock saves duplicate work and is reclaimed when a run dies; the successor
  // claim below is what makes a fork impossible even when a slow run's lock was reclaimed.
  const bucket = cfg.appwrite.checkpointsBucket;
  const lockId = `cpl_${space.key}_${prev ? prev.seq : "genesis"}`;
  if (!(await takeLock(b, bucket, lockId, space, prev, { reclaim: !(trusted && !prev) }))) {
    return { created: false, reason: "another checkpoint run is extending the latest checkpoint" };
  }
  const release = () => b.files.delete(bucket, lockId).catch(() => undefined);

  const tree = (prev && (!trusted || trusted.size === cpSize(prev)) ? await incrementalTree(b, bucket, space, prev, size, ring) : null)
    ?? await fullTree(b, space, prev, size, ring, trusted ? { size: trusted.size, root: trusted.root } : undefined);
  if ("refuse" in tree) { await release(); return refuse(tree.refuse, tree.report); }
  if ("incomplete" in tree) { await release(); return { created: false, reason: "the chain is incomplete; retrying on the next run" }; }

  let anchor: Anchor | null = null;
  const anchorDue = !space.settings.lastAnchorAt || Date.now() - Date.parse(space.settings.lastAnchorAt) > 3_600_000;
  if (space.settings.anchoring && prev && anchorDue && cfg.anchor.token && cfg.anchor.repo) {
    anchor = await anchorToGitHub(cfg, prev).catch((e) => { console.error("[engram] anchoring failed", e); return null; });
  }
  const unsigned = await buildCheckpoint({ space: space.key, tree: { size, head: tree.head, root: tree.root }, prev, keyId, anchor });
  const cp = await signCheckpoint(unsigned, opts.privateKey);

  const claim = await claimSuccessor(b, bucket, `${lockId}_c`, cp, space, prev, ring);
  if (claim !== "ours") {
    if ("malformed" in claim) return refuse(claim.malformed);
    return { created: false, reason: "another run already extended the latest checkpoint", checkpoint: claim.winner };
  }
  const fileId = checkpointFileId(cp);
  try {
    await b.files.put(bucket, fileId, `${fileId}.json`, enc.encode(JSON.stringify(cp, null, 2)), b.teamRead(space.teamId));
  } catch (e) {
    if (!isConflict(e)) throw e;
    return { created: false, reason: "checkpoint already exists" };
  }
  const sidecar: FrontierFile = { v: "1", space: space.key, size: cp.size, root: cp.root, frontier: tree.frontier };
  await b.files.put(bucket, frontierId(space.key, cp.seq), `${frontierId(space.key, cp.seq)}.json`, enc.encode(JSON.stringify(sidecar)), b.teamRead(space.teamId))
    .catch((e) => { if (!isConflict(e)) console.error("[engram] could not store the checkpoint frontier", e); });
  await advancePointer(b, space.key, cp, anchor);
  return { created: true, checkpoint: cp };
}

type Tree = { head: string; root: string; frontier: string[] } | { refuse: string; report?: Report } | { incomplete: true };

async function incrementalTree(b: Backend, bucket: string, space: SpaceInfo, prev: Checkpoint, size: number, ring: Record<string, string>): Promise<Tree | null> {
  const frontier = await readFrontier(b, bucket, prev);
  if (!frontier) return null;
  const p = cpSize(prev);
  const entries = await loadChainRange(b, space.key, p - 1, size);
  const last = entries[0];
  const h = last?.metadata.h;
  if (!last || last.$id !== entryId(space.key, p - 1) || last.metadata.hash !== prev.head || headerProblem(h) || (await headerHash(h)) !== prev.head) {
    return { refuse: `Entry #${p - 1} no longer matches signed checkpoint ${checkpointFileId(prev)}. History was rewritten.` };
  }
  const v = new ChainVerifier({ space: space.key, publicKeys: ring, from: { size: p, head: prev.head, createdAt: h.createdAt } });
  const fresh = entries.slice(1);
  await v.push(fresh);
  const report = await v.finish();
  if (report.status === "tampered") return { refuse: report.findings.find((f) => f.severity === "critical")!.message, report };
  if (p + fresh.length !== size) return { incomplete: true };
  const hashes = fresh.map((e) => e.metadata.hash);
  const next = await frontierAppendHex(frontier, p, hashes);
  return { head: hashes[hashes.length - 1], root: await frontierRootHex(next), frontier: next };
}

async function fullTree(b: Backend, space: SpaceInfo, prev: Checkpoint | null, size: number, ring: Record<string, string>, trusted?: { size: number; root: string }): Promise<Tree> {
  const entries = (await loadChain(b, space.key, { limit: size })).slice(0, size);
  // Checking against prev (and the trust anchor) is enough: the chain links every entry, prev's root covers its first
  // prev.size leaves, and prev itself was only signed after the same check. Older files are the sentinel's job.
  const report = await verifySpace({ space: space.key, entries, checkpoints: prev ? [prev] : [], publicKeys: ring, trusted });
  if (report.status === "tampered") return { refuse: report.findings.find((f) => f.severity === "critical")!.message, report };
  if (entries.length !== size) return { incomplete: true };
  const hashes = entries.map((e) => e.metadata.hash);
  const frontier = await frontierAppendHex([], 0, hashes);
  return { head: hashes[hashes.length - 1], root: await frontierRootHex(frontier), frontier };
}

/**
 * Create-first claim of "the successor of prev". Never deleted or reclaimed, so at most one checkpoint ever extends a
 * given checkpoint. A run that loses finishes the winner's work (its file and the pointer) in case the winner died.
 */
async function claimSuccessor(b: Backend, bucket: string, claimId: string, cp: Checkpoint, space: SpaceInfo, prev: Checkpoint | null, ring: Record<string, string>):
  Promise<"ours" | { winner: Checkpoint } | { malformed: string }> {
  try {
    await b.files.put(bucket, claimId, `${claimId}.json`, enc.encode(JSON.stringify(cp)), b.teamRead(space.teamId));
    return "ours";
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
  const bytes = await b.files.get(bucket, claimId);
  const parsed = bytes ? parseCheckpoint(claimId, bytes, space.key) : null;
  const winner = parsed && "cp" in parsed ? parsed.cp : null;
  const key = winner ? ring[winner.keyId] : undefined;
  const links = winner && (prev
    ? winner.prevCheckpoint === checkpointFileId(prev) && winner.prevCheckpointHash === (await checkpointHash(prev))
    : winner.prevCheckpoint === null);
  if (!winner || !key || !links || !(await verifyCheckpointSig(winner, key))) {
    return { malformed: `The successor claim ${claimId} is not a valid checkpoint extending ${prev ? checkpointFileId(prev) : "the start of the chain"}. It was altered outside Engram.` };
  }
  const fileId = checkpointFileId(winner);
  await b.files.put(bucket, fileId, `${fileId}.json`, enc.encode(JSON.stringify(winner, null, 2)), b.teamRead(space.teamId))
    .catch((e) => { if (!isConflict(e)) throw e; });
  await advancePointer(b, space.key, winner, null);
  return { winner };
}

/** latestCheckpoint is the server-side trust anchor: it only ever moves forward. */
async function advancePointer(b: Backend, spaceKey: string, cp: Checkpoint, anchor: Anchor | null) {
  const fresh = await getSpace(b, spaceKey);
  const cur = fresh?.settings.latestCheckpoint;
  if (cur && cur.size >= cpSize(cp)) return;
  await updateSettings(b, spaceKey, {
    latestCheckpoint: { fileId: checkpointFileId(cp), seq: Number(cp.seq), size: cpSize(cp), root: cp.root, createdAt: cp.createdAt },
    ...(anchor ? { lastAnchorAt: iso() } : { lastAnchorAt: fresh?.settings.lastAnchorAt ?? null }),
  });
}

const LOCK_STALE_MS = 5 * 60_000;
/** Longer than a storage round trip: a reclaimer that judged the same stale lock has deleted by then, if at all. */
const LOCK_SETTLE_MS = 250;
const sameBytes = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

async function takeLock(b: Backend, bucket: string, lockId: string, space: SpaceInfo, prev: Checkpoint | null, opts: { reclaim: boolean }): Promise<boolean> {
  const body = enc.encode(JSON.stringify({ at: iso(), prev: prev?.seq ?? null, token: randomSalt() }));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await b.files.put(bucket, lockId, `${lockId}.json`, body, b.teamRead(space.teamId));
      if (attempt === 0) return true;
      // Storage has no conditional delete, so another reclaimer that saw the same stale lock may still delete
      // ours. Its delete lands within one round trip; whoever's lock survives the wait owns it.
      await new Promise((r) => setTimeout(r, LOCK_SETTLE_MS));
      return sameBytes(await b.files.get(bucket, lockId), body);
    } catch (e) {
      if (!isConflict(e)) throw e;
      // Never reclaim the start of the chain once a checkpoint was signed: that is how a forged history would get signed.
      if (!opts.reclaim) return false;
      // A run that took the lock and died must not block checkpoints forever.
      const raw = await b.files.get(bucket, lockId);
      if (!raw) continue;
      let at = 0;
      try { at = Date.parse(JSON.parse(dec.decode(raw)).at); } catch { at = 0; }
      const latest = await latestCheckpoint(b, space.key);
      const stillPrev = (latest?.seq ?? null) === (prev?.seq ?? null);
      if (!stillPrev || Date.now() - (at || 0) < LOCK_STALE_MS) return false;
      // Remove only the exact stale lock judged above: another run may have reclaimed it and taken a fresh one.
      if (!sameBytes(await b.files.get(bucket, lockId), raw)) return false;
      await b.files.delete(bucket, lockId);
    }
  }
  return false;
}

/** Ask the checkpoint Function to run; sign inline only if this process holds the key. */
export async function requestCheckpoint(ctx: Ctx): Promise<CheckpointRun> {
  if (await ctx.b.jobs.triggerCheckpoint(ctx.space.key)) return { created: false, reason: "queued in checkpoint Function" };
  if (ctx.cfg.checkpoint.privateKey) {
    const fresh = (await getSpace(ctx.b, ctx.space.key)) ?? ctx.space;
    return runCheckpoint(ctx.b, fresh, { privateKey: ctx.cfg.checkpoint.privateKey });
  }
  return { created: false, reason: "no signing key in this process and no checkpoint Function configured" };
}

export type ScheduledCheckpointResult = { space: string; created: boolean; seq: string | null; reason: string | null; status: "created" | "idle" | "refused" | "error" };

/**
 * The scheduled run over many spaces: least recently checkpointed first, and no new space once `budgetMs` has passed,
 * so a run ends inside the Function timeout and the next one starts with the spaces this one skipped.
 */
export async function runScheduledCheckpoints(b: Backend, spaces: SpaceInfo[], opts: { privateKey: string; budgetMs: number }) {
  const started = Date.now();
  const ordered = [...spaces].sort((x, y) => (x.settings.latestCheckpoint?.createdAt ?? "").localeCompare(y.settings.latestCheckpoint?.createdAt ?? ""));
  const results: ScheduledCheckpointResult[] = [];
  const skipped: string[] = [];
  for (const s of ordered) {
    if (Date.now() - started >= opts.budgetMs) { skipped.push(s.key); continue; }
    try {
      const r = await runCheckpoint(b, s, { privateKey: opts.privateKey });
      results.push({ space: s.key, created: r.created, seq: r.checkpoint?.seq ?? null, reason: r.reason ?? null, status: r.created ? "created" : r.refused ? "refused" : "idle" });
    } catch (e) {
      console.error(`[engram] checkpoint failed for ${s.key}`, e);
      results.push({ space: s.key, created: false, seq: null, reason: e instanceof Error ? e.message : String(e), status: "error" });
    }
  }
  return { results, skipped };
}

/** Publish a root to a public GitHub repository: an outside timestamp the operator cannot rewrite. */
export async function anchorToGitHub(cfg: EngramConfig, cp: Checkpoint): Promise<Anchor | null> {
  if (!cfg.anchor.token || !cfg.anchor.repo) return null;
  const path = `anchors/${cp.space}/${cp.seq}.json`;
  const body = JSON.stringify({ space: cp.space, seq: cp.seq, size: cp.size, root: cp.root, head: cp.head, createdAt: cp.createdAt, sig: cp.sig }, null, 2);
  const res = await fetch(`https://api.github.com/repos/${cfg.anchor.repo}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${cfg.anchor.token}`, Accept: "application/vnd.github+json", "User-Agent": "engram-anchor" },
    body: JSON.stringify({ message: `Anchor ${cp.space} checkpoint ${Number(cp.seq)}`, content: toBase64(enc.encode(body)) }),
  });
  if (!res.ok) throw new Error(`GitHub anchoring failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { commit?: { sha?: string } };
  const sha = json.commit?.sha;
  // Signed into the checkpoint, so never an empty string that looks like a reference: null when GitHub gave none.
  return { type: "github", repo: cfg.anchor.repo, commit: typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? sha : null, path, anchoredSeq: cp.seq };
}

