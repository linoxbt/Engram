/** Agent registry: the vector is the agent's description, so agents can be found by capability. */
import { agentId, count8, iso, keyHash, sha256Hex, timingSafeEqualHex } from "@engram/core";
import type { Backend, Filter, VDoc } from "./backend/types";
import { ALL_SCOPES, backgroundDefer, type Ctx, type Scope, type SpaceInfo } from "./context";
import { getConfig } from "./config";
import { embedAgentDescription } from "./embed";
import { EngramError, isConflict } from "./errors";
import type { CreateAgentInput } from "./schemas";
import { getSpace } from "./spaces";

export interface AgentMeta {
  space: string;
  name: string;
  description: string;
  keyPrefix: string;
  keyHash: string;
  scopes: Scope[];
  publicKey: string | null;
  status: "active" | "revoked";
  createdAt: string;
  createdBy: string;
  lastSeenAt: string | null;
  writes: string;
  recalls: string;
}
export type AgentDoc = VDoc<AgentMeta>;
export type PublicAgent = Omit<AgentMeta, "keyHash"> & { id: string };

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomB62(n: number) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => B62[b % 62]).join("");
}

export const toPublicAgent = (d: AgentDoc): PublicAgent => {
  const { keyHash: _k, ...rest } = d.metadata;
  return { id: d.$id, ...rest };
};

export async function createAgent(b: Backend, space: SpaceInfo, input: CreateAgentInput, createdBy: string): Promise<{ agent: PublicAgent; key: string }> {
  const prefix = `eng_${randomB62(4)}`;
  const key = `${prefix}_${randomB62(32)}`;
  const id = agentId(space.key);
  const meta: AgentMeta = {
    space: space.key,
    name: input.name,
    description: input.description,
    keyPrefix: prefix,
    keyHash: await keyHash(key),
    scopes: input.scopes as Scope[],
    publicKey: null,
    status: "active",
    createdAt: iso(),
    createdBy,
    lastSeenAt: null,
    writes: count8(0),
    recalls: count8(0),
  };
  // No document permissions, unlike every other write: the agents collection has documentSecurity off (see
  // scripts/setup.ts) and the document holds the key hash, so only the server's API key ever reads it.
  const doc = await b.vectors.create<AgentMeta>("agents", id, { embeddings: await embedAgentDescription(b, `${input.name}: ${input.description}`), metadata: meta });
  return { agent: toPublicAgent(doc), key };
}

const AGENT_PAGE = 100;
/** Every agent document matching `filters`, read in pages of 100 in `$id` order. */
async function queryAllAgents(b: Backend, filters: Filter[]): Promise<AgentDoc[]> {
  const out: AgentDoc[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await b.vectors.query<AgentMeta>("agents", { filters, order: { field: "$id", dir: "asc" }, limit: AGENT_PAGE, cursorAfter: cursor, withVectors: false });
    out.push(...page);
    if (page.length < AGENT_PAGE) return out;
    cursor = page[page.length - 1].$id;
  }
}

export async function listAgents(b: Backend, space: string): Promise<PublicAgent[]> {
  const docs = await queryAllAgents(b, [{ op: "eq", path: "metadata.space", values: [space] }]);
  return docs.map(toPublicAgent).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/**
 * Read-modify-write that only lands on the version it read. Revocation and stats bumps both rewrite the whole
 * document; unconditional writes let a bump that read before a revoke write `status: "active"` back after it.
 */
async function updateAgent(b: Backend, id: string, mutate: (m: AgentMeta) => AgentMeta | null, attempts: number): Promise<AgentDoc | null> {
  for (let i = 0; ; i++) {
    const d = await b.vectors.get<AgentMeta>("agents", id);
    if (!d) return null;
    const next = mutate(d.metadata);
    if (!next) return d;
    try {
      return await b.vectors.update<AgentMeta>("agents", id, { metadata: next }, undefined, { ifUpdatedAt: d.$updatedAt });
    } catch (e) {
      if (!isConflict(e) || i + 1 >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 40 * (i + 1)));
    }
  }
}

export async function revokeAgent(b: Backend, space: string, id: string) {
  const d = await b.vectors.get<AgentMeta>("agents", id);
  if (!d || d.metadata.space !== space) throw new EngramError("not_found", "Agent not found.");
  await updateAgent(b, id, (m) => (m.status === "revoked" ? null : { ...m, status: "revoked" }), 10);
  authCache.clear();
}

/**
 * Offboarding: revoke every active key a person created, in one space or (spaceKey null) in every space. A key
 * must not outlive its creator's access. Returns the number of keys revoked.
 */
export async function revokeAgentsCreatedBy(b: Backend, spaceKey: string | null, userId: string): Promise<number> {
  const createdBy = userId.startsWith("user:") ? userId : `user:${userId}`;
  const filters: Filter[] = [{ op: "eq", path: "metadata.createdBy", values: [createdBy] }];
  if (spaceKey) filters.push({ op: "eq", path: "metadata.space", values: [spaceKey] });
  const docs = (await queryAllAgents(b, filters)).filter((d) => d.metadata.status === "active");
  for (const d of docs) await updateAgent(b, d.$id, (m) => (m.status === "revoked" ? null : { ...m, status: "revoked" }), 10);
  authCache.clear();
  return docs.length;
}

export async function findAgentsByCapability(b: Backend, space: string, query: string, k = 3) {
  const v = await embedAgentDescription(b, query);
  const docs = await b.vectors.query<AgentMeta>("agents", { vector: v, filters: [{ op: "eq", path: "metadata.space", values: [space] }], limit: k, withVectors: false });
  return docs.map((d) => ({ ...toPublicAgent(d), distance: d.$distance ?? null }));
}

const nameCache = new Map<string, { name: string; at: number }>();
export async function agentName(b: Backend, id: string, space?: SpaceInfo): Promise<string> {
  if (id.startsWith("user:")) return space?.settings.people[id.slice(5)] ?? "person";
  // System authors (system:reflect, system:retention) are not agent documents, and ':' is not a valid document ID.
  if (id.startsWith("system:")) return id;
  const hit = nameCache.get(id);
  if (hit && Date.now() - hit.at < 300_000) return hit.name;
  const d = await b.vectors.get<AgentMeta>("agents", id);
  const name = d?.metadata.name ?? id;
  nameCache.set(id, { name, at: Date.now() });
  return name;
}
export async function agentNames(b: Backend, ids: string[], space?: SpaceInfo): Promise<Record<string, string>> {
  const uniq = [...new Set(ids)];
  const names = await Promise.all(uniq.map((id) => agentName(b, id, space)));
  return Object.fromEntries(uniq.map((id, i) => [id, names[i]]));
}

const authCache = new Map<string, { ctx: Omit<Ctx, "defer">; at: number }>();
const KEY_RE = /^(eng_[A-Za-z0-9]{4})_[A-Za-z0-9]{32}$/;

/** Bearer-key auth: hash the key, find the agent by prefix, compare in constant time, build a context. */
export async function authAgent(b: Backend, bearer: string | null | undefined, defer = backgroundDefer): Promise<Ctx> {
  const key = (bearer ?? "").replace(/^Bearer\s+/i, "").trim();
  const m = KEY_RE.exec(key);
  if (!m) throw new EngramError("unauthorized", "Missing or malformed agent key. Send Authorization: Bearer eng_...");
  const hit = authCache.get(key);
  // Short TTL: a revoked key stops working on every instance within 10 seconds.
  if (hit && Date.now() - hit.at < 10_000) return { ...hit.ctx, defer };
  const h = await keyHash(key);
  const docs = await b.vectors.query<AgentMeta>("agents", { filters: [{ op: "eq", path: "metadata.keyPrefix", values: [m[1]] }], limit: 10, withVectors: false });
  const doc = docs.find((d) => timingSafeEqualHex(d.metadata.keyHash, h));
  if (!doc) throw new EngramError("unauthorized", "Unknown agent key.");
  if (doc.metadata.status !== "active") throw new EngramError("unauthorized", "This agent key was revoked.");
  const space = await getSpace(b, doc.metadata.space);
  if (!space) throw new EngramError("unauthorized", "The space for this key no longer exists.");
  const ctx: Omit<Ctx, "defer"> = { b, cfg: getConfig(), space, actor: doc.$id, actorName: doc.metadata.name, scopes: doc.metadata.scopes };
  authCache.set(key, { ctx, at: Date.now() });
  return { ...ctx, defer };
}

/** Operator secrets (cron, seed) in `Authorization: Bearer`: hashed first, so the compare is fixed-length and leaks no length. */
export async function bearerMatches(header: string | null | undefined, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(header ?? ""), sha256Hex(`Bearer ${secret}`)]);
  return timingSafeEqualHex(a, b);
}

export function requireScope(ctx: Ctx, scope: Scope) {
  if (!ctx.scopes.includes(scope)) throw new EngramError("forbidden", `This agent key lacks the "${scope}" scope.`);
}

/** Context for a person acting through the dashboard. */
export function personCtx(b: Backend, space: SpaceInfo, user: { id: string; name: string }, defer = backgroundDefer): Ctx {
  return { b, cfg: getConfig(), space, actor: `user:${user.id}`, actorName: user.name || "person", scopes: ALL_SCOPES, defer };
}

/** Best effort: a counter that loses a race is not worth failing the request for, but it must never undo a revoke. */
export async function bumpAgentStats(b: Backend, id: string, field: "writes" | "recalls") {
  if (id.startsWith("user:")) return;
  await updateAgent(b, id, (m) => ({ ...m, [field]: count8(Number(m[field] ?? "0") + 1), lastSeenAt: iso() }), 3).catch((e) => {
    if (!isConflict(e)) throw e;
  });
}

