/** Server-side verification (agents, sentinel) and inclusion proofs. The browser runs the same core code. */
import {
  checkpointFileId, cpSize, fromHex, iso, leafHash, proofFromLeafHashes, publicKeyFromPrivate, rootFromLeafHashes, seqOf, toHex, verifySpace,
  type ChainEntry, type Checkpoint, type Finding, type Report, type TrustedCheckpoint,
} from "@engram/core";
import type { Backend } from "./backend/types";
import { loadChain } from "./chain";
import { getConfig, keyringOf, type EngramConfig } from "./config";
import type { Ctx, SpaceInfo } from "./context";
import { latestCheckpoint, loadChainRange, loadCheckpointFiles } from "./checkpoints";
import { EngramError } from "./errors";
import type { CheckpointPointer, IntegrityStatus } from "./settings";
import { getSpace, updateSettings } from "./spaces";

/**
 * The newest checkpoint the signer recorded in team prefs: the server-side trust anchor. Someone with database and
 * storage access can delete every checkpoint file and write a different, internally consistent chain; this pointer
 * is what such a history no longer matches.
 */
export function trustedOf(space: SpaceInfo): TrustedCheckpoint | undefined {
  const p = space.settings.latestCheckpoint;
  return p && Number.isSafeInteger(p.size) && p.size > 0 && typeof p.root === "string" ? { size: p.size, root: p.root } : undefined;
}

export interface VerifyOptions {
  /** Also compare published GitHub anchors with the checkpoints they name (the sentinel does this). */
  anchors?: boolean;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/**
 * Every key server-side verification trusts: the configured keyring and, in a process that signs, its own key. With
 * none at all the verifier says so as a warning on every report; it never treats unchecked signatures as valid.
 */
export async function serverKeyring(cfg: EngramConfig = getConfig()): Promise<Record<string, string>> {
  const ring = keyringOf(cfg);
  if (!ring[cfg.checkpoint.keyId] && cfg.checkpoint.privateKey) {
    try { ring[cfg.checkpoint.keyId] = await publicKeyFromPrivate(cfg.checkpoint.privateKey); } catch { /* malformed key: the signer reports it */ }
  }
  return ring;
}

export async function verifyStoredSpace(b: Backend, space: SpaceInfo, mode: "standard" | "deep" = "standard", opts: VerifyOptions = {}): Promise<Report> {
  const cfg = getConfig();
  const [entries, files, publicKeys] = await Promise.all([loadChain(b, space.key, { withVectors: mode === "deep" }), loadCheckpointFiles(b, space.key), serverKeyring(cfg)]);
  // Malformed files go to the verifier as they are, so they become critical findings instead of disappearing.
  const checkpoints = [...files.checkpoints, ...files.malformed.map((m) => m.raw as Checkpoint)];
  const report = await verifySpace({ space: space.key, entries, checkpoints, publicKeys, mode, trusted: trustedOf(space) });
  if (opts.anchors && cfg.anchor.repo) return withFindings(report, await verifyAnchors(files.checkpoints, opts.fetch ?? fetch));
  return report;
}

/** Add findings found outside the core verifier and recompute the verdict the same way it does. */
export function withFindings(r: Report, extra: Finding[]): Report {
  if (!extra.length) return r;
  const findings = [...r.findings, ...extra].sort((a, b) => a.seq - b.seq || (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  const crit = findings.filter((f) => f.severity === "critical");
  return {
    ...r, findings,
    validThrough: crit.length ? Math.min(r.entries, ...crit.map((f) => f.seq)) - 1 : r.entries - 1,
    status: crit.length ? "tampered" : findings.some((f) => f.severity === "warning") ? "warning" : "valid",
  };
}

const anchorOk = new Set<string>();
type Published = { space?: unknown; seq?: unknown; root?: unknown };
const MAX_ANCHOR_FETCHES = 3;

/**
 * GitHub anchors are signed into later checkpoints but are only evidence if someone compares them: fetch the published
 * file and check it names the same root as the checkpoint it anchors. A different root is critical (the checkpoint was
 * replaced after it was anchored); an unreachable file is a warning. Confirmed anchors at a pinned commit are remembered per process.
 */
export async function verifyAnchors(checkpoints: Checkpoint[], fetchImpl: typeof fetch = fetch): Promise<Finding[]> {
  const out: Finding[] = [];
  const bySeq = new Map(checkpoints.map((c) => [c.seq, c]));
  let fetched = 0;
  for (const cp of [...checkpoints].reverse()) {
    const a = cp.anchor;
    if (!a || a.type !== "github") continue;
    const target = bySeq.get(a.anchoredSeq);
    if (!target) continue; // a missing checkpoint is reported by the chain verifier
    const at = cpSize(target) - 1;
    const id = `cp_${target.space}_${target.seq}`;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(a.repo) || !/^anchors\/[a-z0-9]{8}\/\d{12}\.json$/.test(a.path) || (a.commit && !/^[0-9a-f]{40}$/.test(a.commit))) {
      out.push({ seq: at, rule: "anchor", severity: "warning", message: `The GitHub anchor for checkpoint ${id} has an unrecognised location and was not checked.` });
      continue;
    }
    const key = `${a.repo}|${a.commit}|${a.path}|${target.root}`;
    if (anchorOk.has(key)) continue;
    if (fetched++ >= MAX_ANCHOR_FETCHES) break;
    const url = `https://raw.githubusercontent.com/${a.repo}/${a.commit || "HEAD"}/${a.path}`;
    let published: Published | null = null;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) published = (await res.json()) as Published;
      else out.push({ seq: at, rule: "anchor", severity: "warning", message: `The GitHub anchor for checkpoint ${id} could not be fetched (HTTP ${res.status}).` });
    } catch (e) {
      out.push({ seq: at, rule: "anchor", severity: "warning", message: `The GitHub anchor for checkpoint ${id} could not be fetched (${e instanceof Error ? e.message : String(e)}).` });
    }
    if (!published) continue;
    if (published.root !== target.root || published.space !== target.space || published.seq !== target.seq) {
      out.push({ seq: at, rule: "anchor", severity: "critical", message: `Checkpoint ${id} does not match the root published on GitHub when it was anchored. It was replaced afterwards.` });
    } else {
      if (a.commit) anchorOk.add(key); // a file at a pinned commit cannot change; one read from HEAD (no commit recorded) can
    }
  }
  return out;
}

export function integrityOf(r: Report): IntegrityStatus {
  const crit = r.findings.filter((f) => f.severity === "critical");
  return {
    status: r.status, validThrough: r.validThrough, entries: r.entries, findings: r.findings.length, critical: crit.length,
    checkedAt: r.checkedAt, firstFinding: (crit[0] ?? r.findings[0])?.message ?? null,
  };
}

/** Contract 2: optional fields on settings.integrity marking that the owner was told about the current incident. */
export type AlertedIntegrity = IntegrityStatus & { alertedAt?: string | null; alertedFor?: string | null };

/**
 * Record a space's integrity badge, and alert the owner once per incident whoever records it (the sentinel, the
 * signer, a person pressing Verify, an agent's verify call). An incident is a continuous run of "tampered" records:
 * the first one that has not been alerted sends the email and stores alertedAt/alertedFor; later ones carry them over.
 */
export async function recordIntegrity(b: Backend, space: SpaceInfo, integrity: IntegrityStatus): Promise<AlertedIntegrity> {
  let next: AlertedIntegrity = integrity;
  if (integrity.status === "tampered") {
    const fresh = (await getSpace(b, space.key)) ?? space;
    const cur = fresh.settings.integrity as AlertedIntegrity | null;
    if (cur?.status === "tampered" && cur.alertedAt) {
      next = { ...integrity, alertedAt: cur.alertedAt, alertedFor: cur.alertedFor ?? null };
    } else if (!fresh.settings.sandbox) {
      try {
        await b.jobs.notifyTamper({ spaceKey: space.key, spaceName: fresh.settings.name, ownerId: fresh.settings.ownerId || undefined, message: integrity.firstFinding ?? "Tampering detected." });
        next = { ...integrity, alertedAt: iso(), alertedFor: integrity.firstFinding ?? null };
      } catch (e) {
        console.error("[engram] tamper alert failed; the next record retries", e);
      }
    }
  }
  await updateSettings(b, space.key, { integrity: next });
  return next;
}

/** Verify and remember the result as the space's integrity badge. */
export async function verifyAndRecord(b: Backend, space: SpaceInfo, mode: "standard" | "deep" = "standard", opts: VerifyOptions = {}): Promise<Report> {
  const r = await verifyStoredSpace(b, space, mode, opts);
  await recordIntegrity(b, space, integrityOf(r));
  return r;
}

/**
 * Authoritative as-of answers replay stored headers, so the replayed prefix (entries created at or before `asOf`) is
 * verified first: hashes, links and the signed checkpoint that covers it (the smallest one at least as long as the
 * prefix; entries up to its size are checked so its root can be). Derived fields are not consulted, so derived rules
 * are skipped. Refuses (409) when the prefix does not verify.
 */
export async function verifyHistoryAt(b: Backend, space: SpaceInfo, chain: ChainEntry[], asOf: string): Promise<{ prefix: number; report: Report; checkpoint: CheckpointPointer | null }> {
  let prefix = chain.findIndex((e) => e.metadata.h.createdAt > asOf);
  if (prefix < 0) prefix = chain.length;
  const [files, publicKeys] = await Promise.all([loadCheckpointFiles(b, space.key), serverKeyring()]);
  const covering = files.checkpoints.find((c) => cpSize(c) >= prefix && prefix > 0) ?? null;
  const end = covering ? cpSize(covering) : chain.length;
  const t = trustedOf(space);
  const report = await verifySpace({
    space: space.key, entries: chain.slice(0, end), mode: "public", publicKeys,
    checkpoints: [...files.checkpoints.filter((c) => cpSize(c) <= end), ...files.malformed.map((m) => m.raw as Checkpoint)],
    trusted: t && t.size <= end ? t : undefined,
  });
  if (report.status === "tampered" && report.validThrough < prefix - 1) {
    const first = report.findings.find((f) => f.severity === "critical");
    throw new EngramError("conflict", `The history up to ${asOf} does not verify: ${first?.message ?? "tampering was found"} Authoritative as-of answers are refused until it is restored.`);
  }
  const checkpoint = covering
    ? { fileId: checkpointFileId(covering), seq: Number(covering.seq), size: cpSize(covering), root: covering.root, createdAt: covering.createdAt }
    : null;
  return { prefix, report, checkpoint };
}

export interface Proof {
  id: string;
  seq: number;
  leaf: string;
  index: number;
  checkpoint: Checkpoint & { file: string };
  path: string[];
  publicKey: string | null;
  howToVerify: string;
}

/**
 * Leaf hashes per space for the latest checkpoint, so proofs do not page through the chain on every request. Kept
 * only when they recompute the checkpoint's signed root, so a cached proof is always a proof of signed history. A
 * newer checkpoint extends the cached prefix by loading only the entries after it.
 */
interface LeafCache { fileId: string; root: string; hashes: string[]; leaves: Uint8Array[] }
const leafCache = new Map<string, LeafCache>();
const LEAF_CACHE_SPACES = 16;

async function leavesFor(b: Backend, spaceKey: string, cp: Checkpoint): Promise<{ hashes: string[]; leaves: Uint8Array[] }> {
  const file = `cp_${spaceKey}_${cp.seq}`;
  const size = cpSize(cp);
  const hit = leafCache.get(spaceKey);
  if (hit && hit.fileId === file && hit.root === cp.root) return hit;
  let hashes: string[] | null = null;
  if (hit && hit.hashes.length < size) {
    const more = await loadChainRange(b, spaceKey, hit.hashes.length, size);
    if (more.length === size - hit.hashes.length) hashes = [...hit.hashes, ...more.map((e) => e.metadata.hash)];
  }
  const extended = hashes !== null;
  hashes ??= (await loadChain(b, spaceKey, { limit: size })).map((e) => e.metadata.hash);
  const leaves = extended
    ? [...hit!.leaves, ...(await Promise.all(hashes.slice(hit!.hashes.length).map((h) => leafHash(fromHex(h)))))]
    : await Promise.all(hashes.map((h) => leafHash(fromHex(h))));
  if (hashes.length === size && toHex(await rootFromLeafHashes(leaves)) === cp.root) {
    leafCache.delete(spaceKey);
    leafCache.set(spaceKey, { fileId: file, root: cp.root, hashes, leaves });
    while (leafCache.size > LEAF_CACHE_SPACES) leafCache.delete(leafCache.keys().next().value!);
  } else if (extended) {
    // The cached prefix plus new entries do not reproduce the root: start over from the stored chain.
    leafCache.delete(spaceKey);
    return leavesFor(b, spaceKey, cp);
  }
  return { hashes, leaves };
}

export async function proofFor(b: Backend, space: SpaceInfo, id: string): Promise<Proof> {
  const seq = seqOf(id);
  if (!Number.isFinite(seq) || !id.startsWith(`m_${space.key}_`)) throw new EngramError("bad_request", "Not an entry of this space.");
  const cp = await latestCheckpoint(b, space.key);
  if (!cp) throw new EngramError("not_found", "This space has no signed checkpoint yet.");
  const size = cpSize(cp);
  if (seq >= size) throw new EngramError("not_found", `Entry #${seq} is newer than the latest checkpoint (${size} entries). It will be covered by the next one.`);
  const { hashes, leaves } = await leavesFor(b, space.key, cp);
  const cfg: EngramConfig = getConfig();
  const file = `cp_${space.key}_${cp.seq}`;
  return {
    id, seq, leaf: hashes[seq], index: seq,
    checkpoint: { ...cp, file },
    path: (await proofFromLeafHashes(leaves, seq)).map(toHex),
    publicKey: (await serverKeyring(cfg))[cp.keyId] ?? null,
    howToVerify: `${cfg.appUrl ?? ""}/verify/${space.key}?proof=${encodeURIComponent(id)}`,
  };
}

/** The verify tool: whole space, or one memory's inclusion proof. */
export async function verifyTool(ctx: Ctx, args: { id?: string; mode?: "standard" | "deep" }) {
  const r = await verifyAndRecord(ctx.b, ctx.space, args.mode ?? "standard");
  const base = {
    // "warning" stays a warning: derived fields or unchecked signatures are not the same as a clean chain.
    status: r.status,
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
