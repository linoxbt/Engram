/**
 * Signed Merkle checkpoints in Storage. The signing key lives only where
 * checkpoints are made (the checkpoint Function, or the app when no Function
 * is configured); verifiers need only the public key.
 */
import {
  buildCheckpoint, checkpointFileId, cpSize, iso, signCheckpoint, toBase64, type Anchor, type Checkpoint,
} from "@engram/core";
import type { Backend } from "./backend/types";
import { chainHead, loadChain } from "./chain";
import { getConfig, type EngramConfig } from "./config";
import type { Ctx, SpaceInfo } from "./context";
import { ConflictError } from "./errors";
import { getSpace, updateSettings } from "./spaces";

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

  const entries = await loadChain(b, space.key);
  const hashes = entries.slice(0, size).map((e) => e.metadata.hash);
  let anchor: Anchor | null = null;
  const anchorDue = !space.settings.lastAnchorAt || Date.now() - Date.parse(space.settings.lastAnchorAt) > 3_600_000;
  if (space.settings.anchoring && prev && anchorDue && cfg.anchor.token && cfg.anchor.repo) {
    anchor = await anchorToGitHub(cfg, prev).catch((e) => { console.error("[engram] anchoring failed", e); return null; });
  }
  const unsigned = await buildCheckpoint({ space: space.key, hashes, prev, keyId: opts.keyId ?? cfg.checkpoint.keyId, anchor });
  const cp = await signCheckpoint(unsigned, opts.privateKey);
  const fileId = checkpointFileId(cp);
  try {
    await b.files.put(cfg.appwrite.checkpointsBucket, fileId, `${fileId}.json`, new TextEncoder().encode(JSON.stringify(cp, null, 2)), b.teamRead(space.teamId));
  } catch (e) {
    if (e instanceof ConflictError) return { created: false, reason: "checkpoint already exists" };
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
