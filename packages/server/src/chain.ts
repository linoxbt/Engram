/**
 * The chain: append with lock-free concurrency control, derived updates on
 * neighbours, and paged reads.
 *
 * Concurrency: an entry's ID is its sequence number. Two writers that read the
 * same head build the same ID; VectorsDB accepts only one create for it, and
 * the loser rebuilds on the new head. The entry is created first (the lock),
 * then derived fields of affected neighbours are updated in one transaction.
 * Derived updates are idempotent and recomputable, so a retry is always safe.
 */
import {
  applyEntry, buildMeta, contentHash, embHash, entryId, genesis, headerHash, initialDerived, iso, patchMeta, randomSalt,
  score, seqOf, seqStr, tombstoneVector, type ChainEntry, type DerivedState, type EntryKind, type EntryMeta, type Header, type Op, type Refs,
} from "@engram/core";
import type { Backend, Collection, Filter, TxOp, VDoc } from "./backend/types";
import { COLLECTION_DIMS, type Ctx } from "./context";
import { EngramError, isConflict } from "./errors";

export type MemDoc = VDoc<EntryMeta>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(20 + Math.random() * 60);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_FUTURE_MS = 5 * 60_000;
export const emptyRefs = (): Refs => ({ supersedes: [], contradicts: [], related: [], target: null, derivedFrom: [] });

export async function chainHead(b: Backend, space: string): Promise<MemDoc | null> {
  const [head] = await b.vectors.query<EntryMeta>("memories", {
    filters: [{ op: "eq", path: "metadata.space", values: [space] }],
    order: { field: "$id", dir: "desc" },
    limit: 1,
    withVectors: false,
  });
  return head ?? null;
}

export async function getEntry(b: Backend, id: string, withVector = false): Promise<MemDoc | null> {
  const d = await b.vectors.get<EntryMeta>("memories", id);
  if (d && !withVector) delete d.embeddings;
  return d;
}

/** Page through a space's chain in order. */
export async function loadChain(b: Backend, space: string, opts: { withVectors?: boolean; limit?: number; onPage?: (page: ChainEntry[]) => Promise<void> | void } = {}): Promise<ChainEntry[]> {
  const out: ChainEntry[] = [];
  let cursor: string | undefined;
  const page = 500;
  for (;;) {
    const docs = await b.vectors.query<EntryMeta>("memories", {
      filters: [{ op: "eq", path: "metadata.space", values: [space] }],
      order: { field: "$id", dir: "asc" },
      limit: page,
      cursorAfter: cursor,
      withVectors: !!opts.withVectors,
    });
    const entries = docs.map((d) => ({ $id: d.$id, metadata: d.metadata, ...(opts.withVectors ? { vector: d.embeddings } : {}) }));
    out.push(...entries);
    if (opts.onPage) await opts.onPage(entries);
    if (docs.length < page || (opts.limit && out.length >= opts.limit)) break;
    cursor = docs[docs.length - 1].$id;
  }
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/**
 * Every matching document, page by page in $id order (desc by default: newest first), up to `max`. For reads where
 * a record past one page must not be silently skipped (erasure, reflection, concept members).
 */
export async function queryAll<M>(b: Backend, coll: Collection, spec: { filters: Filter[]; dir?: "asc" | "desc"; withVectors?: boolean }, max = 20_000, page = 500): Promise<VDoc<M>[]> {
  const out: VDoc<M>[] = [];
  let cursor: string | undefined;
  while (out.length < max) {
    const docs = await b.vectors.query<M>(coll, { filters: spec.filters, order: { field: "$id", dir: spec.dir ?? "desc" }, limit: page, cursorAfter: cursor, withVectors: !!spec.withVectors });
    out.push(...docs);
    if (docs.length < page) break;
    cursor = docs[docs.length - 1].$id;
  }
  return out.slice(0, max);
}

export interface Draft {
  op: Op;
  kind: EntryKind;
  subject: string | null;
  text: string | null;
  /** Quantized vector; omitted for tombstone entries. */
  vector?: number[];
  importance?: number;
  confidence?: number;
  source?: string | null;
  validFrom?: string | null;
  refs?: Partial<Refs>;
  model?: string;
  idem?: string | null;
  relateStatus?: "done" | "pending" | "skipped";
  /** Explicit timestamp: seed routes only. Must not precede the head. */
  createdAt?: string;
  /** Override the acting agent (seed routes write as several agents). */
  agent?: string;
  /** Extra operational derived fields, not checked by the verifier (classifier reasons, summary sources). */
  extra?: Record<string, unknown>;
}

export interface Appended { id: string; seq: number; hash: string; meta: EntryMeta; derivedPending: boolean }

const toState = (m: EntryMeta): DerivedState => ({
  status: m.d.status, validTo: m.d.validTo, supersededBy: m.d.supersededBy,
  contradictedBy: [...(m.d.contradictedBy ?? [])], forgottenAt: m.d.forgottenAt ?? null, forgottenBy: m.d.forgottenBy ?? null,
});

function involvedIds(refs: Refs): string[] {
  return [...new Set([...refs.supersedes, ...refs.contradicts, ...refs.related, ...(refs.target ? [refs.target] : [])])];
}

/** Load referenced docs plus their conflict partners (whose derived state may change too). */
async function loadInvolved(b: Backend, refs: Refs): Promise<Map<string, MemDoc>> {
  const docs = new Map<string, MemDoc>();
  const first = involvedIds(refs);
  for (const d of await Promise.all(first.map((id) => b.vectors.get<EntryMeta>("memories", id)))) if (d) docs.set(d.$id, d);
  const partners = new Set<string>();
  for (const d of docs.values()) for (const p of d.metadata.d.contradictedBy ?? []) if (!docs.has(p)) partners.add(p);
  for (const d of await Promise.all([...partners].map((id) => b.vectors.get<EntryMeta>("memories", id)))) if (d) docs.set(d.$id, d);
  return docs;
}

export interface AppendOptions {
  /** The caller applied pending entries just before (remember does, in parallel with its other reads). */
  pendingChecked?: boolean;
}

export async function append(ctx: Ctx, draft: Draft, opts: AppendOptions = {}): Promise<Appended> {
  const { b, space } = ctx;
  const refs: Refs = { ...emptyRefs(), ...draft.refs };
  const vector = draft.vector ?? tombstoneVector(COLLECTION_DIMS.memories);
  const salt = randomSalt();
  const evh = await embHash(vector, draft.vector && draft.text != null ? salt : null);
  const perms = b.teamRead(space.teamId);
  if (draft.createdAt !== undefined) {
    // A far-future timestamp would freeze every later entry at it: createdAt never decreases.
    if (!ISO_RE.test(draft.createdAt) || !Number.isFinite(Date.parse(draft.createdAt))) throw new EngramError("bad_request", `Explicit createdAt ${draft.createdAt} is not a 24-character ISO time.`);
    if (Date.parse(draft.createdAt) > Date.now() + MAX_FUTURE_MS) throw new EngramError("bad_request", `Explicit createdAt ${draft.createdAt} is in the future.`);
  }
  // Hashed into the header, so one canonical form: 24-char UTC ISO.
  const validFrom = draft.validFrom ? Date.parse(draft.validFrom) : null;
  if (validFrom !== null && !(Number.isFinite(validFrom) && validFrom >= 0 && validFrom < 253402300800000)) throw new EngramError("bad_request", `validFrom ${draft.validFrom} is not a valid date.`);
  const hasEffects = involvedIds(refs).length > 0;

  for (let attempt = 0; attempt < 8; attempt++) {
    // Helping: earlier entries' effects land before we read the state of the memories we touch. Correctness does
    // not depend on it (our own update below waits for them, in chain order), but it keeps a backlog from growing.
    if (attempt > 0 || !opts.pendingChecked) await applyPending(ctx);
    const [head, involved] = await Promise.all([chainHead(b, space.key), loadInvolved(b, refs)]);
    const seq = head ? seqOf(head.$id) + 1 : 0;
    const prevHash = head ? head.metadata.hash : await genesis(space.key);
    const headAt = head?.metadata.createdAt ?? "";
    if (draft.createdAt && headAt && draft.createdAt < headAt) {
      throw new EngramError("bad_request", `Explicit createdAt ${draft.createdAt} precedes the chain head (${headAt}).`);
    }
    // createdAt never decreases along the chain, even across serverless instances with clock skew.
    const now = iso();
    const createdAt = draft.createdAt ?? (headAt > now ? headAt : now);
    const h: Header = {
      v: "1",
      space: space.key,
      seq: seqStr(seq),
      prevHash,
      op: draft.op,
      kind: draft.kind,
      agent: draft.agent ?? ctx.actor,
      subject: draft.subject ?? null,
      contentHash: await contentHash(salt, draft.text ?? ""),
      embHash: evh,
      model: draft.model ?? (draft.vector ? "nomic-embed-text" : "tombstone"),
      importance: score(draft.importance ?? 5),
      confidence: score(draft.confidence ?? 7),
      source: draft.source ?? null,
      validFrom: validFrom === null ? createdAt : iso(validFrom),
      createdAt,
      refs,
    };
    const hash = await headerHash(h);
    const id = entryId(space.key, seq);

    // Our own derived state, from the neighbours read above. If an earlier pending entry changes them, the update
    // below repairs our side (a partner retired before our update landed is dropped from our conflicts).
    const state = new Map<string, DerivedState>();
    for (const [k, d] of involved) state.set(k, toState(d.metadata));
    applyEntry(state, id, h);
    const mine = state.get(id)!;
    const d = { ...initialDerived(draft.op), ...mine, contradictedBy: [...mine.contradictedBy], relateStatus: draft.relateStatus ?? "done", ...(draft.extra ?? {}) };
    const meta = buildMeta({ h, hash, c: { text: draft.text, salt: draft.text == null ? null : salt }, d, idem: draft.idem ?? null, applied: hasEffects ? "false" : "true" });

    // Entries before ours that may still be pending are read alongside the create: they all exist already,
    // because ours builds on the head that follows them.
    const [created, before] = await Promise.all([
      b.vectors.create<EntryMeta>("memories", id, { embeddings: vector, metadata: meta }, perms).then((doc) => ({ doc, err: null as unknown }), (err: unknown) => ({ doc: null, err })),
      hasEffects ? pendingPage(ctx).catch(() => null) : Promise.resolve([] as MemDoc[]),
    ]);
    let self: MemDoc | null = created.doc;
    if (created.err) {
      if (!isConflict(created.err)) throw created.err;
      // A timed-out create may have succeeded: if the stored entry is ours, we are done.
      const existing = await b.vectors.get<EntryMeta>("memories", id);
      if (existing?.metadata.hash !== hash) { await jitter(); continue; }
      self = existing;
    }
    if (!hasEffects) return { id, seq, hash, meta, derivedPending: false };

    let ok = false;
    try {
      // Strict chain order: entries before ours land first. If one cannot, ours stays pending and the next writer
      // applies both, in order. Applying ours first could leave state that the replay disagrees with.
      const earlier = before ? before.filter((p) => p.$id < id) : null;
      if (earlier && before!.length < PENDING_PAGE) {
        ok = true;
        for (const p of earlier) if (!(await applyOne(ctx, p.$id, p.metadata.h))) { ok = false; break; }
        // Our neighbours were read before the create; any earlier entry applied since makes that copy stale.
        const fresh = !earlier.length && self && self.$updatedAt ? { docs: involved, self } : undefined;
        if (ok) ok = await updateNeighbours(ctx, id, h, 5, fresh);
      } else {
        ok = !(await applyPending(ctx, { through: id })).blocked;
      }
    } catch (e) {
      // The entry is committed; its effects stay pending and the next writer applies them.
      console.error(`[engram] neighbour update for ${id} failed; left pending`, e);
      ok = false;
    }
    return { id, seq, hash, meta, derivedPending: !ok };
  }
  throw new EngramError("chain_busy", "The chain is busy with other writers. Retry with the same idempotency key.");
}

/**
 * Apply an entry's effect to the derived fields of the memories it touches.
 * Idempotent: re-applying an entry that already took effect changes nothing.
 * Callers keep chain order: an entry is applied only after every earlier one (see applyPending).
 * `preload`: documents the caller has just read, used for the first attempt only (a stale copy fails the
 * conditional write and the next attempt re-reads).
 */
export async function updateNeighbours(ctx: Ctx, id: string, h: Header, attempts = 5, preload?: { docs: Map<string, MemDoc>; self: MemDoc }): Promise<boolean> {
  const { b } = ctx;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const [docs, self] = attempt === 0 && preload
      ? [preload.docs, preload.self]
      : await Promise.all([loadInvolved(b, h.refs), b.vectors.get<EntryMeta>("memories", id)]);
    const state = new Map<string, DerivedState>();
    for (const [k, d] of docs) state.set(k, toState(d.metadata));
    const changed = applyEntry(state, id, h);
    const ops: TxOp[] = [];
    for (const cid of changed) {
      if (cid === id) continue;
      const doc = docs.get(cid);
      const st = state.get(cid);
      if (!doc || !st) continue;
      const before = JSON.stringify(toState(doc.metadata));
      if (before === JSON.stringify(st) && !(st.status === "forgotten" && doc.metadata.c.text != null)) continue;
      const erase = st.status === "forgotten";
      const metadata = patchMeta(doc.metadata, { ...st, contradictedBy: [...st.contradictedBy], ...(erase ? ERASED_NOTES : {}) }, erase ? { text: null, salt: null } : undefined);
      ops.push({
        action: "update", coll: "memories", id: cid, ifUpdatedAt: doc.$updatedAt,
        data: erase ? { metadata, embeddings: tombstoneVector(COLLECTION_DIMS.memories) } : { metadata },
      });
    }
    // The entry's own conflicts were computed when it was created, from neighbours read before the create. If a
    // later entry retired one of them before this update landed, drop it here: a superseded or forgotten memory
    // cannot be in conflict, and nothing else would ever clear it.
    let selfMeta = self?.metadata;
    if (self && selfMeta) {
      const mine = selfMeta.d.contradictedBy ?? [];
      const keep = mine.filter((c) => { const st = state.get(c); return !st || st.status === "active"; });
      if (keep.length !== mine.length) selfMeta = patchMeta(selfMeta, { contradictedBy: keep });
    }
    // Mark this entry applied in the same transaction, so a crash leaves it visibly pending.
    if (self && selfMeta && (self.metadata.applied === "false" || selfMeta !== self.metadata)) {
      ops.push({ action: "update", coll: "memories", id, ifUpdatedAt: self.$updatedAt, data: { metadata: { ...selfMeta, applied: "true" } } });
    }
    if (!ops.length) return true;
    try {
      await b.vectors.transact(ops);
      return true;
    } catch (e) {
      if (!isConflict(e)) throw e;
      await jitter();
    }
  }
  console.error(`[engram] derived update for ${id} gave up after ${attempts} attempts`);
  return false;
}

/** Classifier reasons can quote memory text, so a forgotten memory's notes go with its text. */
const ERASED_NOTES = { reasons: {} } as unknown as Partial<EntryMeta["d"]>;

const PENDING_PAGE = 100;
const pendingPage = (ctx: Ctx, cursorAfter?: string) => ctx.b.vectors.query<EntryMeta>("memories", {
  filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }, { op: "eq", path: "metadata.applied", values: ["false"] }],
  order: { field: "$id", dir: "asc" },
  limit: PENDING_PAGE,
  cursorAfter,
  withVectors: false,
});

async function applyOne(ctx: Ctx, id: string, h: Header, attempts?: number): Promise<boolean> {
  try { return await updateNeighbours(ctx, id, h, attempts); }
  catch (e) { console.error(`[engram] could not apply pending entry ${id}`, e); return false; }
}

/**
 * Helping: apply the effects of entries whose neighbour updates never committed (a crashed instance, a lost
 * race), strictly in chain order, before this writer reads any derived state. Derived state is a fold over the
 * chain and the fold is order-sensitive (when two entries supersede one memory, the earlier one wins), so the
 * pass stops at the first entry that does not land: applying a later one first would leave state the replay
 * disagrees with. Idempotent, so concurrent helpers are safe. With `through`, later entries are left alone.
 */
export async function applyPending(ctx: Ctx, opts: { through?: string; attempts?: number } = {}): Promise<{ applied: number; blocked: boolean }> {
  let applied = 0;
  let cursor: string | undefined;
  // Bounded: a backlog this long is a job for repair, not for one request.
  for (let pages = 0; pages < 50; pages++) {
    const page = await pendingPage(ctx, cursor);
    for (const p of page) {
      if (opts.through && p.$id > opts.through) return { applied, blocked: false };
      if (!(await applyOne(ctx, p.$id, p.metadata.h, opts.attempts))) return { applied, blocked: true };
      applied++;
    }
    if (page.length < PENDING_PAGE) return { applied, blocked: false };
    cursor = page[page.length - 1].$id;
  }
  return { applied, blocked: true };
}

/** Patch derived fields of one entry without touching the chain (access counts, concept, relate status). */
export async function patchDerived(b: Backend, id: string, patch: Partial<EntryMeta["d"]> | ((d: EntryMeta["d"]) => Partial<EntryMeta["d"]> | Record<string, unknown>)): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const doc = await b.vectors.get<EntryMeta>("memories", id);
    if (!doc) return;
    try {
      // Conditional on the read: a stale copy must never write back erased content. A function patch is computed
      // from this read, so merges (classifier reasons) never drop a concurrent change.
      const p = (typeof patch === "function" ? patch(doc.metadata.d) : patch) as Partial<EntryMeta["d"]>;
      await b.vectors.update("memories", id, { metadata: patchMeta(doc.metadata, p) }, undefined, { ifUpdatedAt: doc.$updatedAt });
      return;
    } catch (e) {
      if (!isConflict(e)) throw e;
      await jitter();
    }
  }
}

/**
 * Rebuild derived state for a whole space from the chain and erase content of
 * forgotten memories. Run by people from Settings, never silently.
 *
 * Writers keep appending meanwhile: before each write, entries appended since the snapshot are folded in, and
 * the write is conditional on the document read, so a neighbour update that lands first is re-read, never
 * overwritten. A document still contended after a few tries is counted and skipped.
 */
export async function repairSpace(ctx: Ctx): Promise<{ fixed: number; erased: number; conflicts: number }> {
  const { b } = ctx;
  const entries = await loadChain(b, ctx.space.key);
  const state = new Map<string, DerivedState>();
  for (const e of entries) applyEntry(state, e.$id, e.metadata.h);
  let lastId = entries[entries.length - 1]?.$id;
  const catchUp = async () => {
    for (;;) {
      const more = await b.vectors.query<EntryMeta>("memories", {
        filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }], order: { field: "$id", dir: "asc" }, cursorAfter: lastId, limit: 100, withVectors: false,
      });
      for (const d of more) { applyEntry(state, d.$id, d.metadata.h); lastId = d.$id; }
      if (more.length < 100) return;
    }
  };
  const needs = (m: EntryMeta, st: DerivedState) =>
    JSON.stringify(toState(m)) !== JSON.stringify(st) || (st.status === "forgotten" && m.c.text != null) || m.status !== m.d.status || m.applied === "false";

  let fixed = 0, erased = 0, conflicts = 0;
  for (const e of entries) {
    if (!state.has(e.$id) || !needs(e.metadata, state.get(e.$id)!)) continue;
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      const cur = await b.vectors.get<EntryMeta>("memories", e.$id);
      if (!cur) { done = true; break; }
      await catchUp();
      const st = state.get(e.$id)!;
      const m = cur.metadata;
      if (!needs(m, st)) { done = true; break; }
      const erase = st.status === "forgotten" && m.c.text != null;
      try {
        await b.vectors.update("memories", e.$id, {
          metadata: { ...patchMeta(m, { ...st, contradictedBy: [...st.contradictedBy], ...(erase ? ERASED_NOTES : {}) }, erase ? { text: null, salt: null } : undefined), applied: "true" },
          ...(erase ? { embeddings: tombstoneVector(COLLECTION_DIMS.memories) } : {}),
        }, undefined, { ifUpdatedAt: cur.$updatedAt });
        fixed++;
        if (erase) erased++;
        done = true;
      } catch (err) {
        if (!isConflict(err)) throw err;
        await jitter();
      }
    }
    if (!done) conflicts++;
  }
  return { fixed, erased, conflicts };
}
