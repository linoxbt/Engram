/** Server-side verification (agents, sentinel) and inclusion proofs. The browser runs the same core code. */
import { cpSize, iso, proofHex, seqOf, verifySpace, type Checkpoint, type Report } from "@engram/core";
import type { Backend } from "./backend/types";
import { loadChain } from "./chain";
import { getConfig } from "./config";
import type { Ctx, SpaceInfo } from "./context";
import { latestCheckpoint, loadCheckpoints } from "./checkpoints";
import { EngramError } from "./errors";
import type { IntegrityStatus } from "./settings";
import { updateSettings } from "./spaces";

export async function verifyStoredSpace(b: Backend, space: SpaceInfo, mode: "standard" | "deep" = "standard"): Promise<Report> {
  const [entries, checkpoints] = await Promise.all([loadChain(b, space.key, { withVectors: mode === "deep" }), loadCheckpoints(b, space.key)]);
  return verifySpace({ space: space.key, entries, checkpoints, publicKeyHex: getConfig().checkpoint.publicKey ?? undefined, mode });
}

export function integrityOf(r: Report): IntegrityStatus {
  const crit = r.findings.filter((f) => f.severity === "critical");
  return {
    status: r.status, validThrough: r.validThrough, entries: r.entries, findings: r.findings.length, critical: crit.length,
    checkedAt: r.checkedAt, firstFinding: (crit[0] ?? r.findings[0])?.message ?? null,
  };
}

/** Verify and remember the result as the space's integrity badge. */
export async function verifyAndRecord(b: Backend, space: SpaceInfo, mode: "standard" | "deep" = "standard"): Promise<Report> {
  const r = await verifyStoredSpace(b, space, mode);
  await updateSettings(b, space.key, { integrity: integrityOf(r) });
  return r;
}

export interface Proof {
  id: string;
  seq: number;
  leaf: string;
  index: number;
  checkpoint: Pick<Checkpoint, "space" | "seq" | "size" | "root" | "head" | "sig" | "createdAt" | "keyId"> & { file: string };
  path: string[];
  publicKey: string | null;
  howToVerify: string;
}

export async function proofFor(b: Backend, space: SpaceInfo, id: string): Promise<Proof> {
  const seq = seqOf(id);
  if (!Number.isFinite(seq) || !id.startsWith(`m_${space.key}_`)) throw new EngramError("bad_request", "Not an entry of this space.");
  const cp = await latestCheckpoint(b, space.key);
  if (!cp) throw new EngramError("not_found", "This space has no signed checkpoint yet.");
  const size = cpSize(cp);
  if (seq >= size) throw new EngramError("not_found", `Entry #${seq} is newer than the latest checkpoint (${size} entries). It will be covered by the next one.`);
  const entries = await loadChain(b, space.key, { limit: size });
  const hashes = entries.map((e) => e.metadata.hash);
  const cfg = getConfig();
  const file = `cp_${space.key}_${cp.seq}`;
  return {
    id, seq, leaf: hashes[seq], index: seq,
    checkpoint: { space: cp.space, seq: cp.seq, size: cp.size, root: cp.root, head: cp.head, sig: cp.sig, createdAt: cp.createdAt, keyId: cp.keyId, file },
    path: await proofHex(hashes, seq),
    publicKey: cfg.checkpoint.publicKey,
    howToVerify: `${cfg.appUrl}/verify/${space.key}?proof=${encodeURIComponent(id)}`,
  };
}

/** The verify tool: whole space, or one memory's inclusion proof. */
export async function verifyTool(ctx: Ctx, args: { id?: string; mode?: "standard" | "deep" }) {
  const r = await verifyAndRecord(ctx.b, ctx.space, args.mode ?? "standard");
  const base = {
    status: r.status === "tampered" ? ("tampered" as const) : ("valid" as const),
    integrity: r.status,
    entries: r.entries,
    validThrough: r.validThrough,
    checkpointsValid: r.checkpointsValid,
    latestCheckpoint: r.latestCheckpoint,
    findings: r.findings.slice(0, 20),
    checkedAt: iso(),
  };
  if (!args.id) return base;
  return { ...base, proof: await proofFor(ctx.b, ctx.space, args.id) };
}
