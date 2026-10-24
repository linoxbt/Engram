/**
 * Signed Merkle checkpoints in Storage. The signing key lives only where
 * checkpoints are made (the checkpoint Function, or the app when no Function
 * is configured); verifiers need only the public key.
 */
import {
  buildCheckpoint, checkpointFileId, checkpointProblem, cpSize, iso, signCheckpoint, toBase64, verifySpace, type Anchor, type Checkpoint,
} from "@engram/core";
import type { Backend } from "./backend/types";
import { chainHead, loadChain } from "./chain";
import { getConfig, type EngramConfig } from "./config";
import type { Ctx, SpaceInfo } from "./context";
import { isConflict } from "./errors";
import { getSpace, updateSettings } from "./spaces";
import { integrityOf } from "./verify";

const fileCache = new Map<string, Checkpoint>();
const dec = new TextDecoder();

export async function loadCheckpoints(b: Backend, spaceKey: string): Promise<Checkpoint[]> {
  const bucket = getConfig().appwrite.checkpointsBucket;
  const files = await b.files.list(bucket, `cp_${spaceKey}_`);
  const out: Checkpoint[] = [];
  for (const f of files) {
    let cp = fileCache.get(f.fileId);
    if (!cp) {
      const bytes = await b.files.get(bucket, f.fileId);
      if (!bytes) continue;
      try { cp = JSON.parse(dec.decode(bytes)) as Checkpoint; } catch { continue; }
      // A malformed file is left to the verifier to report; the engine must never build on it.
      if (checkpointProblem(cp, spaceKey)) continue;
      fileCache.set(f.fileId, cp);
    }
    out.push(cp);
  }
  return out.sort((a, b) => cpSize(a) - cpSize(b));
}

export async function latestCheckpoint(b: Backend, spaceKey: string): Promise<Checkpoint | null> {
  const all = await loadCheckpoints(b, spaceKey);
  return all[all.length - 1] ?? null;
}

export interface CheckpointRun { created: boolean; reason?: string; checkpoint?: Checkpoint }

export async function runCheckpoint(b: Backend, space: SpaceInfo, opts: { privateKey: string; keyId?: string; cfg?: EngramConfig; force?: boolean }): Promise<CheckpointRun> {
  const cfg = opts.cfg ?? getConfig();
  const head = await chainHead(b, space.key);
  if (!head) return { created: false, reason: "empty chain" };
  const size = Number(head.metadata.seq) + 1;
  const prev = await latestCheckpoint(b, space.key);
  if (prev && cpSize(prev) >= size && !opts.force) return { created: false, reason: "no new entries" };

  // One successor per checkpoint: a create-first lock keyed on the previous
  // checkpoint (the same pattern as entry IDs). Overlapping runs would otherwise
  // all link to the same predecessor and fork the checkpoint chain.
  const bucket = cfg.appwrite.checkpointsBucket;
  const lockId = `cpl_${space.key}_${prev ? prev.seq : "genesis"}`;
  if (!(await takeLock(b, bucket, lockId, space, prev))) return { created: false, reason: "another checkpoint run is extending the latest checkpoint" };

  const entries = (await loadChain(b, space.key)).slice(0, size);
  // The signer is the trust anchor: it must never certify a chain that does not verify. Without this, anyone who
  // rewrites or deletes entries after the latest checkpoint gets the change signed on the next scheduled run.
  const report = await verifySpace({ space: space.key, entries, checkpoints: prev ? [...(await loadCheckpoints(b, space.key))] : [], publicKeyHex: cfg.checkpoint.publicKey ?? undefined });
  if (entries.length !== size || report.status === "tampered") {
    await b.files.delete(bucket, lockId).catch(() => undefined);
    await updateSettings(b, space.key, { integrity: integrityOf(report) }).catch(() => undefined);
    return { created: false, reason: `refusing to sign: ${report.findings.find((f) => f.severity === "critical")?.message ?? "the chain is incomplete"}` };
  }
  const hashes = entries.map((e) => e.metadata.hash);
  let anchor: Anchor | null = null;
  const anchorDue = !space.settings.lastAnchorAt || Date.now() - Date.parse(space.settings.lastAnchorAt) > 3_600_000;
  if (space.settings.anchoring && prev && anchorDue && cfg.anchor.token && cfg.anchor.repo) {
    anchor = await anchorToGitHub(cfg, prev).catch((e) => { console.error("[engram] anchoring failed", e); return null; });
  }
  const unsigned = await buildCheckpoint({ space: space.key, hashes, prev, keyId: opts.keyId ?? cfg.checkpoint.keyId, anchor });
  const cp = await signCheckpoint(unsigned, opts.privateKey);
  const fileId = checkpointFileId(cp);
  try {
    await b.files.put(bucket, fileId, `${fileId}.json`, new TextEncoder().encode(JSON.stringify(cp, null, 2)), b.teamRead(space.teamId));
  } catch (e) {
    await b.files.delete(bucket, lockId).catch(() => undefined); // let a later run extend prev
    if (isConflict(e)) return { created: false, reason: "checkpoint already exists" };
    throw e;
  }
  fileCache.set(fileId, cp);
  const fresh = await getSpace(b, space.key);
  await updateSettings(b, space.key, {
    latestCheckpoint: { fileId, seq: Number(cp.seq), size: cpSize(cp), root: cp.root, createdAt: cp.createdAt },
    ...(anchor ? { lastAnchorAt: iso() } : { lastAnchorAt: fresh?.settings.lastAnchorAt ?? null }),
  });
  return { created: true, checkpoint: cp };
}

const LOCK_STALE_MS = 5 * 60_000;

async function takeLock(b: Backend, bucket: string, lockId: string, space: SpaceInfo, prev: Checkpoint | null): Promise<boolean> {
  const body = new TextEncoder().encode(JSON.stringify({ at: iso(), prev: prev?.seq ?? null }));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await b.files.put(bucket, lockId, `${lockId}.json`, body, b.teamRead(space.teamId));
      return true;
    } catch (e) {
      if (!isConflict(e)) throw e;
      // A run that took the lock and died must not block checkpoints forever.
      const raw = await b.files.get(bucket, lockId);
      let at = 0;
      try { at = raw ? Date.parse(JSON.parse(dec.decode(raw)).at) : 0; } catch { at = 0; }
      const latest = await latestCheckpoint(b, space.key);
      const stillPrev = (latest?.seq ?? null) === (prev?.seq ?? null);
      if (!stillPrev || Date.now() - at < LOCK_STALE_MS) return false;
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

/** Publish a root to a public GitHub repository: an outside timestamp the operator cannot rewrite. */
export async function anchorToGitHub(cfg: EngramConfig, cp: Checkpoint): Promise<Anchor | null> {
  if (!cfg.anchor.token || !cfg.anchor.repo) return null;
  const path = `anchors/${cp.space}/${cp.seq}.json`;
  const body = JSON.stringify({ space: cp.space, seq: cp.seq, size: cp.size, root: cp.root, head: cp.head, createdAt: cp.createdAt, sig: cp.sig }, null, 2);
  const res = await fetch(`https://api.github.com/repos/${cfg.anchor.repo}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${cfg.anchor.token}`, Accept: "application/vnd.github+json", "User-Agent": "engram-anchor" },
    body: JSON.stringify({ message: `Anchor ${cp.space} checkpoint ${Number(cp.seq)}`, content: toBase64(new TextEncoder().encode(body)) }),
  });
  if (!res.ok) throw new Error(`GitHub anchoring failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { commit?: { sha?: string } };
  return { type: "github", repo: cfg.anchor.repo, commit: json.commit?.sha ?? "", path, anchoredSeq: cp.seq };
}
