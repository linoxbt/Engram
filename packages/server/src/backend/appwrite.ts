/** Appwrite backend: VectorsDB, Embeddings, Teams, Storage, Auth, Functions and Messaging. */
import {
  Account, AppwriteException, Client, Embeddings, EmbeddingModel, Functions, ID, Messaging, Query, Storage, Teams, Users, VectorsDB, type Models,
} from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { randomBytes } from "node:crypto";
import { bool, type EngramConfig } from "../config";
import { ConflictError, EngramError, isEngramError, REAUTH_WINDOW_MS, reauthRequired } from "../errors";
import { evaluate } from "./query";
import { clearAttempts, guardedSignIn, type AttemptStore } from "./login-guard";
import { cosine } from "@engram/core";
import { GUEST_EMAIL_DOMAIN, isGuestEmail, SIGNUP_CONFLICT } from "./types";
import type {
  AuthStore, Backend, Collection, Embedder, EmbedModel, FileInfo, FileStore, Filter, Jobs, PasskeyChallenge, PasskeyInfo, QuerySpec, TeamInfo, TeamMember, TeamStore, TxOp,
  User, VDoc, VectorStore,
} from "./types";

function mapError(e: unknown): unknown {
  if (e instanceof AppwriteException) {
    if (e.type === "database_not_found" || e.type === "collection_not_found") {
      return new EngramError("unavailable", "Engram's VectorsDB database is not provisioned yet. VectorsDB needs a dedicated database on the Appwrite Pro plan; after upgrading, run `pnpm setup:appwrite`.");
    }
    if (e.code === 409) return new ConflictError(e.message);
    if (e.code === 404) return new EngramError("not_found", e.message);
    if (e.code === 402) return new EngramError("embeddings_unavailable", "Appwrite embeddings quota reached for this billing period.");
    if (e.code === 429) return new EngramError("rate_limited", "Appwrite rate limit reached. Try again shortly.");
  }
  return e;
}
/** A session check that failed for a reason other than the session being invalid. */
function unavailableAuth(e: unknown): unknown {
  const m = mapError(e);
  if (isEngramError(m) && m.code !== "not_found") return m;
  console.warn("[engram] session check failed", e instanceof Error ? e.message : e);
  return new EngramError("unavailable", "Sign-in is temporarily unavailable. Try again shortly.");
}
/** Appwrite only redirects to hosts registered as a platform; say so plainly instead of a raw 400. */
function authLinkError(e: unknown): unknown {
  if (e instanceof AppwriteException && e.code === 400 && /url/i.test(e.message)) {
    return new EngramError("unavailable", "Email links need this site's address added as a Web platform in the Appwrite console.");
  }
  if (e instanceof AppwriteException && e.code === 429) return new EngramError("rate_limited", "Too many emails were requested. Try again in a few minutes.");
  return mapError(e);
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { throw mapError(e); }
}
const isNotFound = (e: unknown) => (e instanceof AppwriteException && e.code === 404) || (isEngramError(e) && e.code === "not_found");

function toQueries(f: Filter): string {
  switch (f.op) {
    case "eq": {
      const vals = f.values.filter((v): v is string => v !== null);
      const hasNull = vals.length !== f.values.length;
      if (hasNull && vals.length) return Query.or([Query.equal(f.path, vals), Query.isNull(f.path)]);
      return hasNull ? Query.isNull(f.path) : Query.equal(f.path, vals);
    }
    case "ne": return f.value === null ? Query.isNotNull(f.path) : Query.notEqual(f.path, f.value);
    case "lt": return Query.lessThan(f.path, f.value);
    case "lte": return Query.lessThanEqual(f.path, f.value);
    case "gt": return Query.greaterThan(f.path, f.value);
    case "gte": return Query.greaterThanEqual(f.path, f.value);
    case "isNull": return Query.isNull(f.path);
    case "isNotNull": return Query.isNotNull(f.path);
    case "contains": return Query.contains(f.path, f.value);
    case "startsWith": return Query.startsWith(f.path, f.value);
  }
}

/**
 * $updatedAt has millisecond precision, so two writes in one millisecond would defeat a timestamp-only
 * compare-and-swap (seen live: docs/verified.md, appwrite-live). Every write therefore stamps a random revision
 * into the stored metadata (`_rev`), reads fold it into the opaque version token the engine passes back as
 * `ifUpdatedAt`, and conditional writes match on the revision. The engine never sees `_rev`: reads strip it.
 */
const newRev = () => Math.random().toString(16).slice(2, 12).padEnd(10, "0");
const stamp = <T extends { metadata?: unknown }>(data: T): T =>
  data.metadata && typeof data.metadata === "object" ? { ...data, metadata: { ...(data.metadata as object), _rev: newRev() } } : data;
function untoken(d: { $updatedAt?: string; metadata?: { _rev?: string } } | null | undefined) {
  if (!d) return d;
  const rev = d.metadata?._rev ?? "";
  if (d.metadata && "_rev" in d.metadata) delete d.metadata._rev;
  d.$updatedAt = `${d.$updatedAt}~${rev}`;
  return d;
}
const splitToken = (token: string) => {
  const i = token.lastIndexOf("~");
  return i < 0 ? { at: token, rev: "" } : { at: token.slice(0, i), rev: token.slice(i + 1) };
};

class AppwriteVectors implements VectorStore {
  private selectOk = true;
  constructor(private vdb: VectorsDB, private db: string, private cfg: EngramConfig) {}

  async create<M>(coll: Collection, id: string, data: { embeddings: number[]; metadata: M }, perms?: string[]) {
    const doc = await call(() => this.vdb.createDocument({ databaseId: this.db, collectionId: coll, documentId: id, data: stamp(data) as any, permissions: perms }));
    return untoken(doc as any) as unknown as VDoc<M>;
  }
  async get<M>(coll: Collection, id: string): Promise<VDoc<M> | null> {
    try {
      const doc = await this.vdb.getDocument({ databaseId: this.db, collectionId: coll, documentId: id });
      return untoken(doc as any) as unknown as VDoc<M>;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw mapError(e);
    }
  }
  async update<M>(coll: Collection, id: string, data: { embeddings?: number[]; metadata?: M }, perms?: string[], opts: { ifUpdatedAt?: string } = {}) {
    if (opts.ifUpdatedAt) {
      await this.transact([{ action: "update", coll, id, data, perms, ifUpdatedAt: opts.ifUpdatedAt }]);
      return (await this.get<M>(coll, id))!;
    }
    const doc = await call(() => this.vdb.updateDocument({ databaseId: this.db, collectionId: coll, documentId: id, data: stamp(data) as any, permissions: perms }));
    return untoken(doc as any) as unknown as VDoc<M>;
  }
  async delete(coll: Collection, id: string) {
    try { await this.vdb.deleteDocument({ databaseId: this.db, collectionId: coll, documentId: id }); }
    catch (e) { if (!isNotFound(e)) throw mapError(e); }
  }

  async query<M>(coll: Collection, q: QuerySpec): Promise<VDoc<M>[]> {
    // Fallback (Day 1 experiment 2): if vector queries cannot be combined with
    // metadata filters, over-fetch by vector and filter in code.
    if (q.vector && !this.cfg.vectorFilters && q.filters?.length) {
      const wide = await this.run<M>(coll, { vector: q.vector, limit: Math.max(200, (q.limit ?? 25) * 5) });
      return evaluate(wide, { ...q, vector: undefined, order: undefined });
    }
    return this.run<M>(coll, q);
  }

  private async run<M>(coll: Collection, q: QuerySpec): Promise<VDoc<M>[]> {
    const qs: string[] = [];
    if (q.vector) qs.push(Query.vectorCosine("embeddings", q.vector));
    for (const f of q.filters ?? []) qs.push(toQueries(f));
    if (q.order && !q.vector) qs.push(q.order.dir === "asc" ? Query.orderAsc(q.order.field) : Query.orderDesc(q.order.field));
    if (q.cursorAfter) qs.push(Query.cursorAfter(q.cursorAfter));
    qs.push(Query.limit(q.limit ?? 25));
    // Vector queries always fetch embeddings so a missing $distance can be computed locally.
    const withSelect = q.withVectors === false && this.selectOk && !q.vector ? [...qs, Query.select(["$id", "$createdAt", "$updatedAt", "metadata"])] : qs;
    let docs: VDoc<M>[];
    try {
      docs = (await this.vdb.createQuery({ databaseId: this.db, collectionId: coll, queries: withSelect, total: false })).documents as unknown as VDoc<M>[];
    } catch (e) {
      // Only a complaint about the select itself switches it off; any other 400 is a real error.
      if (withSelect !== qs && e instanceof AppwriteException && e.code === 400 && /select|attribute/i.test(e.message)) {
        this.selectOk = false; // select unsupported on this collection type; fetch whole documents
        docs = (await call(() => this.vdb.createQuery({ databaseId: this.db, collectionId: coll, queries: qs, total: false }))).documents as unknown as VDoc<M>[];
      } else throw mapError(e);
    }
    if (q.vector) {
      for (const d of docs) {
        if (typeof d.$distance !== "number") d.$distance = d.embeddings ? 1 - cosine(q.vector, d.embeddings) : undefined;
        if (q.withVectors === false) delete d.embeddings;
      }
    }
    for (const d of docs) untoken(d as { $updatedAt?: string; metadata?: { _rev?: string } });
    return docs;
  }

  /**
   * Atomic batch through VectorsDB transactions. Where Appwrite cannot find a transaction it just created (seen on
   * new dedicated databases), the batch is applied one document at a time instead, each conditional write as a
   * compare-and-swap. That is safe for the engine: derived updates are idempotent and an entry is marked applied
   * last, so a batch cut short stays visibly pending and the next writer finishes it.
   */
  async transact(ops: TxOp[]) {
    if (!ops.length) return;
    if (this.txOk) {
      try { return await this.transactAtomic(ops); }
      catch (e) {
        if (!(e instanceof AppwriteException && e.type === "transaction_not_found")) throw mapError(e);
        console.warn("[engram] VectorsDB transactions unavailable; applying batches one document at a time");
        this.txOk = false;
      }
    }
    for (const op of ops) {
      if (op.action === "update" && op.ifUpdatedAt) await this.compareAndSwap(op.coll, op.id, op.data, op.ifUpdatedAt);
      else if (op.action === "update") await call(() => this.vdb.updateDocument({ databaseId: this.db, collectionId: op.coll, documentId: op.id, data: stamp(op.data) as any }));
      else if (op.action === "delete") await this.delete(op.coll, op.id);
      else await call(() => this.vdb.createDocument({ databaseId: this.db, collectionId: op.coll, documentId: op.id, data: stamp(op.data) as any, permissions: op.perms }));
    }
  }
  private txOk = true;

  private async transactAtomic(ops: TxOp[]) {
    const tx = await this.vdb.createTransaction({ ttl: 60 });
    try {
      await this.vdb.createOperations({
        transactionId: tx.$id,
        operations: ops.map((op) => ({
          action: op.action,
          databaseId: this.db,
          collectionId: op.coll,
          documentId: op.id,
          ...(op.action === "delete" ? {} : { data: stamp(op.data as { metadata?: unknown }) }),
        })),
      });
      // Conditional updates: once staged, Appwrite's commit fails if a staged document changes.
      // Re-reading now closes the window between our read and the staging.
      for (const op of ops) {
        if (op.action !== "update" || !op.ifUpdatedAt) continue;
        const cur = await this.vdb.getDocument({ databaseId: this.db, collectionId: op.coll, documentId: op.id }) as { $updatedAt: string; metadata?: { _rev?: string } };
        if (`${cur.$updatedAt}~${cur.metadata?._rev ?? ""}` !== op.ifUpdatedAt) throw new ConflictError(`Document ${op.id} changed since it was read`);
      }
      await this.vdb.updateTransaction({ transactionId: tx.$id, commit: true });
    } catch (e) {
      try { await this.vdb.updateTransaction({ transactionId: tx.$id, rollback: true }); } catch { /* already closed */ }
      throw e instanceof AppwriteException && e.type === "transaction_not_found" ? e : mapError(e);
    }
  }

  /**
   * Update one document only if it is still the version we read: an update filtered on its ID and the revision
   * stamped by the write that produced that version. Documents written before revisions existed fall back to the
   * millisecond $updatedAt match once; the update itself stamps a revision, so the fallback never repeats.
   */
  private async compareAndSwap(coll: Collection, id: string, data: unknown, token: string) {
    const { at, rev } = splitToken(token);
    const res = await call(() => this.vdb.updateDocuments({
      databaseId: this.db, collectionId: coll, data: stamp(data as { metadata?: unknown }) as object,
      queries: [Query.equal("$id", [id]), rev ? Query.equal("metadata._rev", [rev]) : Query.equal("$updatedAt", [at])],
    }));
    if (!res.documents.length) throw new ConflictError(`Document ${id} changed since it was read`);
  }
}

class AppwriteEmbedder implements Embedder {
  constructor(private api: Embeddings) {}
  async embed(texts: string[], model: EmbedModel): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const chunk = texts.slice(i, i + 32);
      const res = await call(() => this.api.createTextEmbeddings({
        texts: chunk, model: model === "all-minilm" ? EmbeddingModel.Allminilm : EmbeddingModel.Nomicembedtext,
      }));
      for (const e of res.embeddings) {
        if (e.error || !e.embedding.length) throw new EngramError("embeddings_unavailable", `Embedding failed: ${e.error || "empty vector"}`);
        out.push(e.embedding);
      }
    }
    return out;
  }
}

class AppwriteTeams implements TeamStore {
  constructor(private teams: Teams, private users: Users) {}
  async create(teamId: string, name: string) { await call(() => this.teams.create({ teamId, name })); }
  async delete(teamId: string) { await call(() => this.teams.delete({ teamId })); }
  async rename(teamId: string, name: string) { await call(() => this.teams.updateName({ teamId, name })); }
  async getPrefs<P extends object>(teamId: string): Promise<P | null> {
    try { return (await this.teams.getPrefs({ teamId })) as unknown as P; }
    catch (e) { if (isNotFound(e)) return null; throw mapError(e); }
  }
  async updatePrefs<P extends object>(teamId: string, prefs: P) { await call(() => this.teams.updatePrefs({ teamId, prefs })); }
  async addMember(teamId: string, userId: string, roles: string[]) { await call(() => this.teams.createMembership({ teamId, roles, userId })); }
  async membership(teamId: string, userId: string) {
    try {
      const res = await this.teams.listMemberships({ teamId, queries: [Query.equal("userId", [userId]), Query.limit(1)] });
      const m = res.memberships[0];
      return m && m.confirm !== false ? { roles: m.roles } : null;
    } catch (e) { if (isNotFound(e)) return null; throw mapError(e); }
  }
  async listMembers(teamId: string): Promise<TeamMember[]> {
    const out: TeamMember[] = [];
    let cursor: string | undefined;
    for (;;) {
      const res = await call(() => this.teams.listMemberships({ teamId, queries: [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] }));
      for (const m of res.memberships) if (m.confirm) out.push({ userId: m.userId, name: m.userName, email: m.userEmail, roles: m.roles, joinedAt: m.joined || null });
      if (res.memberships.length < 100) break;
      cursor = res.memberships[res.memberships.length - 1].$id;
    }
    return out;
  }
  async removeMember(teamId: string, userId: string) {
    const res = await call(() => this.teams.listMemberships({ teamId, queries: [Query.equal("userId", [userId]), Query.limit(1)] }));
    const m = res.memberships[0];
    if (m) await call(() => this.teams.deleteMembership({ teamId, membershipId: m.$id }));
  }
  async listForUser(userId: string): Promise<TeamInfo[]> {
    const out: TeamInfo[] = [];
    let cursor: string | undefined;
    for (;;) {
      const qs = [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
      const res = await call(() => this.users.listMemberships({ userId, queries: qs }));
      // Invitations not yet accepted are not memberships.
      for (const m of res.memberships) if (m.confirm) out.push({ teamId: m.teamId, name: m.teamName, roles: m.roles });
      if (res.memberships.length < 100) break;
      cursor = res.memberships[res.memberships.length - 1].$id;
    }
    return out;
  }
  async listAll(prefix: string) {
    const out: { teamId: string; name: string }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const qs = [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
      const res = await call(() => this.teams.list({ queries: qs }));
      for (const t of res.teams) if (t.$id.startsWith(prefix)) out.push({ teamId: t.$id, name: t.name });
      if (res.teams.length < 100) break;
      cursor = res.teams[res.teams.length - 1].$id;
    }
    return out;
  }
}

class AppwriteFiles implements FileStore {
  private prefixOk = true;
  constructor(private storage: Storage) {}
  async put(bucket: string, fileId: string, name: string, bytes: Uint8Array, perms: string[]) {
    await call(() => this.storage.createFile({ bucketId: bucket, fileId, file: InputFile.fromBuffer(bytes, name), permissions: perms }));
  }
  async get(bucket: string, fileId: string) {
    try { return await toBytes(await this.storage.getFileView({ bucketId: bucket, fileId })); }
    catch (e) { if (isNotFound(e)) return null; throw mapError(e); }
  }
  async list(bucket: string, namePrefix: string): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    let cursor: string | undefined;
    for (;;) {
      const qs = [Query.limit(100), Query.orderAsc("$id"), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
      let res;
      if (this.prefixOk) {
        try { res = await this.storage.listFiles({ bucketId: bucket, queries: [Query.startsWith("name", namePrefix), ...qs] }); }
        catch (e) { if (e instanceof AppwriteException && e.code === 400 && /startsWith|query|attribute/i.test(e.message)) this.prefixOk = false; else throw mapError(e); }
      }
      // Fallback: list everything and filter by prefix below. Slower, but complete: full-text search could miss a
      // checkpoint, and a missed checkpoint would start a second chain.
      if (!res) res = await call(() => this.storage.listFiles({ bucketId: bucket, queries: qs }));
      for (const f of res.files) if (f.name.startsWith(namePrefix)) out.push({ fileId: f.$id, name: f.name, createdAt: f.$createdAt, size: f.sizeOriginal });
      if (res.files.length < 100) break;
      cursor = res.files[res.files.length - 1].$id;
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : 1));
  }
  async delete(bucket: string, fileId: string) {
    try { await this.storage.deleteFile({ bucketId: bucket, fileId }); } catch (e) { if (!isNotFound(e)) throw mapError(e); }
  }
}

/**
 * File bodies arrive as different binary types across SDK versions and runtimes (ArrayBuffer, Buffer, Blob, a
 * stream). `new Uint8Array(x)` on the wrong one silently yields zero bytes, which once hid every checkpoint.
 */
async function toBytes(x: unknown): Promise<Uint8Array> {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (typeof x === "string") return new TextEncoder().encode(x);
  if (x && typeof (x as Blob).arrayBuffer === "function") return new Uint8Array(await (x as Blob).arrayBuffer());
  if (x && typeof (x as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (x as ReadableStream<Uint8Array>).getReader();
    const parts: Uint8Array[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  throw new EngramError("internal", `Unexpected file body type: ${Object.prototype.toString.call(x)}`);
}

/**
 * Accepting the Terms sets a label as well as `prefs.termsAcceptedAt`: a user can write their own prefs through
 * Appwrite with the public project ID, but only the API key can set labels, so the label is what counts.
 */
const TERMS_LABEL = "terms";
function toUser(u: Models.User<Models.Preferences>): User {
  const prefs = (u.prefs ?? {}) as Record<string, unknown>;
  const at = typeof prefs.termsAcceptedAt === "string" ? prefs.termsAcceptedAt : u.$createdAt;
  return { id: u.$id, email: u.email, name: u.name, emailVerified: u.emailVerification, termsAcceptedAt: u.labels?.includes(TERMS_LABEL) ? at : null, guest: isGuestEmail(u.email) };
}

const toPasskeyInfo = (p: { $id: string; $createdAt: string; name: string; accessedAt: string }): PasskeyInfo =>
  ({ id: p.$id, name: p.name, createdAt: p.$createdAt, lastUsedAt: p.accessedAt || null });
const passkeyMessage = (e: AppwriteException) =>
  /expired/i.test(e.message) ? "The passkey request expired. Try again." : e.message || "The passkey could not be saved.";

/** Lifetime of the Realtime JWT handed to the browser (Appwrite's default; the maximum is 3600). */
export const JWT_TTL_S = 900;

class AppwriteAuth implements AuthStore {
  constructor(private cfg: EngramConfig, private admin: Client) {
    this.attempts = { files: new AppwriteFiles(new Storage(admin)), bucket: cfg.appwrite.checkpointsBucket };
  }
  private anon() { return new Client().setEndpoint(this.cfg.appwrite.endpoint).setProject(this.cfg.appwrite.projectId); }
  async signUp(email: string, password: string, name: string): Promise<User> {
    try {
      const u = await new Account(this.anon()).create({ userId: ID.unique(), email, password, name });
      return { id: u.$id, email: u.email, name: u.name };
    } catch (e) {
      // Same messages as the local backend; a bare 409 would otherwise read as a chain conflict.
      if (e instanceof AppwriteException && e.code === 409) throw new EngramError("conflict", SIGNUP_CONFLICT);
      if (e instanceof AppwriteException && e.code === 400) throw new EngramError("bad_request", e.message);
      throw mapError(e);
    }
  }
  /** Attempt slots live as server-only files in the checkpoints bucket (see login-guard.ts). */
  private attempts: AttemptStore;
  async signIn(email: string, password: string, opts: { client?: string } = {}) {
    // No user lookup first: unknown and known addresses take the same path.
    return guardedSignIn(this.attempts, email, opts.client, async () => {
      try {
        const s = await new Account(this.admin).createEmailPasswordSession({ email, password });
        return { secret: s.secret, userId: s.userId, expire: s.expire };
      } catch (e) {
        if (e instanceof AppwriteException && (e.code === 401 || e.code === 400)) throw new EngramError("unauthorized", "Invalid email or password.");
        throw mapError(e);
      }
    });
  }
  async getUser(secret: string): Promise<User | null> {
    try {
      return toUser(await new Account(this.anon().setSession(secret)).get());
    } catch (e) {
      // Only Appwrite's 401 means the session is gone. Anything else (an outage, a network error) must not look
      // like being signed out, which would clear the cookie and bounce people to the login page.
      if (e instanceof AppwriteException && e.code === 401) return null;
      throw unavailableAuth(e);
    }
  }
  /** End every other session of the user behind `sessionSecret` (after a password change). */
  private async endOtherSessions(sessionSecret: string) {
    const account = this.account(sessionSecret);
    const [me, current] = await Promise.all([call(() => account.get()), call(() => account.getSession({ sessionId: "current" }))]);
    const users = new Users(this.admin);
    const list = await call(() => users.listSessions({ userId: me.$id }));
    await Promise.all(list.sessions.filter((s) => s.$id !== current.$id).map((s) => users.deleteSession({ userId: me.$id, sessionId: s.$id }).catch((e) => {
      if (!(e instanceof AppwriteException && e.code === 404)) throw mapError(e);
    })));
  }
  async signOut(secret: string) {
    try { await new Account(this.anon().setSession(secret)).deleteSession({ sessionId: "current" }); } catch { /* already gone */ }
  }
  async findUserByEmail(email: string): Promise<User | null> {
    const res = await call(() => new Users(this.admin).list({ queries: [Query.equal("email", [email]), Query.limit(1)] }));
    const u = res.users[0];
    return u ? { id: u.$id, email: u.email, name: u.name } : null;
  }
  async requestRecovery(email: string, url: string) {
    try {
      await new Account(this.anon()).createRecovery({ email, url });
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 404) return {}; // unknown address: say nothing
      throw authLinkError(e);
    }
    return {};
  }
  async completeRecovery(userId: string, secret: string, password: string) {
    try {
      await new Account(this.anon()).updateRecovery({ userId, secret, password });
      // A successful reset proves ownership of the email, so it lifts any sign-in lockout.
      const users = new Users(this.admin);
      await users.get({ userId }).then((u) => clearAttempts(this.attempts, u.email, { all: true })).catch(() => undefined);
      // And it signs the account out everywhere: whoever knew the old password must not keep a session.
      await users.deleteSessions({ userId }).catch((e) => console.error("[engram] could not end sessions after a password reset", e));
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 400 && /password/i.test(e.message)) throw new EngramError("bad_request", e.message);
      if (e instanceof AppwriteException && (e.code === 401 || e.code === 404 || e.code === 400)) throw new EngramError("bad_request", "This reset link is invalid or has expired. Request a new one.");
      throw mapError(e);
    }
  }
  async requestVerification(sessionSecret: string, url: string) {
    try {
      await new Account(this.anon().setSession(sessionSecret)).createEmailVerification({ url });
    } catch (e) {
      throw authLinkError(e);
    }
    return {};
  }
  async completeVerification(userId: string, secret: string, sessionSecret: string | null) {
    const client = sessionSecret ? this.anon().setSession(sessionSecret) : this.anon();
    try {
      await new Account(client).updateEmailVerification({ userId, secret });
    } catch (e) {
      if (e instanceof AppwriteException && (e.code === 401 || e.code === 404 || e.code === 400)) throw new EngramError("bad_request", "This verification link is invalid or has expired. Send a new one from your account.");
      throw mapError(e);
    }
  }
  async updateName(sessionSecret: string, name: string): Promise<User> {
    return toUser(await call(() => new Account(this.anon().setSession(sessionSecret)).updateName({ name })));
  }
  async updatePassword(sessionSecret: string, oldPassword: string, password: string) {
    try {
      await new Account(this.anon().setSession(sessionSecret)).updatePassword({ password, oldPassword });
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 401) throw new EngramError("unauthorized", "Your current password is incorrect.");
      if (e instanceof AppwriteException && e.code === 400) throw new EngramError("bad_request", e.message);
      throw mapError(e);
    }
    // Every other device is signed out; this one stays.
    await this.endOtherSessions(sessionSecret).catch((e) => console.error("[engram] could not end other sessions after a password change", e));
  }
  async deleteUser(userId: string) {
    await call(() => new Users(this.admin).delete({ userId }));
  }
  /**
   * Guests are registered as server-only marker files (`gu_<userId>`) in the checkpoints bucket, so the clean-up can
   * find them with a prefix listing (proven) instead of a user query on email or labels.
   */
  async createGuest() {
    const users = new Users(this.admin);
    const userId = ID.unique();
    const email = `guest-${userId}@${GUEST_EMAIL_DOMAIN}`;
    // Nobody ever learns this password: it only lets the server open the guest's one session below.
    const password = randomBytes(24).toString("base64url");
    const marker = `gu_${userId}`;
    await this.attempts.files.put(this.attempts.bucket, marker, `${marker}.json`, new TextEncoder().encode("{}"), []);
    try {
      const t = new Date().toISOString();
      await call(() => users.create({ userId, email, password, name: "Guest" }));
      await call(() => users.updatePrefs({ userId, prefs: { guest: true, termsAcceptedAt: t } }));
      const u = await call(() => users.updateLabels({ userId, labels: [TERMS_LABEL, "guest"] }));
      const s = await call(() => new Account(this.admin).createEmailPasswordSession({ email, password }));
      return { user: toUser({ ...u, prefs: { guest: true, termsAcceptedAt: t } }), session: { secret: s.secret, userId: s.userId, expire: s.expire } };
    } catch (e) {
      await users.delete({ userId }).catch(() => undefined);
      await this.attempts.files.delete(this.attempts.bucket, marker).catch(() => undefined);
      throw e;
    }
  }
  async deleteGuests(before: string, limit: number) {
    const markers = (await this.attempts.files.list(this.attempts.bucket, "gu_"))
      .filter((f) => f.createdAt < before)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .slice(0, limit);
    const users = new Users(this.admin);
    let n = 0;
    for (const f of markers) {
      const userId = f.fileId.slice(3);
      try {
        const u = await users.get({ userId });
        // Only ever a guest: the marker names the user, and the address must be under the reserved domain too.
        if (isGuestEmail(u.email)) await users.delete({ userId });
      } catch (e) {
        if (!(e instanceof AppwriteException && e.code === 404)) { console.warn("[engram] guest clean-up failed", e instanceof Error ? e.message : e); continue; }
      }
      await this.attempts.files.delete(this.attempts.bucket, f.fileId);
      n++;
    }
    return n;
  }
  async acceptTerms(userId: string) {
    const users = new Users(this.admin);
    const u = await call(() => users.get({ userId }));
    await call(() => users.updatePrefs({ userId, prefs: { ...u.prefs, termsAcceptedAt: new Date().toISOString() } }));
    if (!u.labels.includes(TERMS_LABEL)) await call(() => users.updateLabels({ userId, labels: [...u.labels, TERMS_LABEL] }));
  }

  // ---- passkeys
  private account(sessionSecret: string) { return new Account(this.anon().setSession(sessionSecret)); }
  /** Appwrite refuses passkey changes on sessions older than 10 minutes; check first for a clear message. */
  private async assertRecent(sessionSecret: string) {
    const s = await call(() => this.account(sessionSecret).getSession({ sessionId: "current" }));
    if (Date.now() - Date.parse(s.$createdAt) > REAUTH_WINDOW_MS) throw reauthRequired();
  }
  /** `sensitive`: Appwrite's 401 there means the sign-in is too old, not that the session is gone. */
  private passkeyCall<T>(fn: () => Promise<T>, sensitive = false): Promise<T> {
    return fn().catch((e) => {
      if (e instanceof AppwriteException) {
        if (e.code === 401) throw sensitive ? reauthRequired() : new EngramError("unauthorized", "Sign in to continue.");
        if (e.code === 400 || e.code === 404 || e.code === 409) throw new EngramError(e.code === 404 ? "not_found" : "bad_request", passkeyMessage(e));
        if (e.code === 403 || e.code === 501) throw new EngramError("unavailable", "Passkeys are not enabled for this Appwrite project. Turn them on under Auth → Settings.");
      }
      throw mapError(e);
    });
  }
  async listPasskeys(sessionSecret: string): Promise<PasskeyInfo[]> {
    const res = await this.passkeyCall(() => this.account(sessionSecret).listPasskeys());
    return res.passkeys.map(toPasskeyInfo);
  }
  async startPasskeyRegistration(sessionSecret: string, name: string): Promise<PasskeyChallenge> {
    await this.assertRecent(sessionSecret);
    const c = await this.passkeyCall(() => this.account(sessionSecret).createPasskey({ passkeyId: ID.unique(), name }), true);
    return { id: c.$id, passkeyId: c.passkeyId || null, publicKey: c.publicKey, expire: c.expire };
  }
  async finishPasskeyRegistration(sessionSecret: string, passkeyId: string, credential: object): Promise<PasskeyInfo> {
    return toPasskeyInfo(await this.passkeyCall(() => this.account(sessionSecret).updatePasskeyVerification({ passkeyId, credential })));
  }
  async renamePasskey(sessionSecret: string, passkeyId: string, name: string): Promise<PasskeyInfo> {
    return toPasskeyInfo(await this.passkeyCall(() => this.account(sessionSecret).updatePasskey({ passkeyId, name })));
  }
  async deletePasskey(sessionSecret: string, passkeyId: string) {
    await this.assertRecent(sessionSecret);
    await this.passkeyCall(() => this.account(sessionSecret).deletePasskey({ passkeyId }), true);
  }
  async startPasskeySignIn(): Promise<PasskeyChallenge> {
    const c = await this.passkeyCall(() => new Account(this.anon()).createPasskeyToken());
    return { id: c.$id, passkeyId: null, publicKey: c.publicKey, expire: c.expire };
  }
  async finishPasskeySignIn(challengeId: string, credential: object) {
    let token: { userId: string; secret: string };
    try {
      token = await new Account(this.anon()).updatePasskeyToken({ challengeId, credential });
    } catch (e) {
      if (e instanceof AppwriteException && e.code < 500) throw new EngramError("unauthorized", "That passkey could not be verified. Try again, or sign in with your password.");
      throw mapError(e);
    }
    // The API key is what lets the server read the new session's secret and set it as our cookie.
    const s = await call(() => new Account(this.admin).createSession({ userId: token.userId, secret: token.secret }));
    return { secret: s.secret, userId: s.userId, expire: s.expire };
  }
  /**
   * The browser only needs this to open its Realtime socket, so it is short-lived (JWT_TTL_S; the page fetches a
   * new one before it expires) and bound to this browser's own session: signing out here voids it at once.
   */
  async createJwt(secret: string) {
    let sessionId: string, userId: string;
    try {
      const s = await this.account(secret).getSession({ sessionId: "current" });
      sessionId = s.$id; userId = s.userId;
    } catch { return null; }
    try {
      const j = await new Users(this.admin).createJWT({ userId, sessionId, duration: JWT_TTL_S });
      return j.jwt;
    } catch { return null; }
  }
}

class AppwriteJobs implements Jobs {
  constructor(private cfg: EngramConfig, private admin: Client) {}
  async triggerCheckpoint(spaceKey: string) {
    const fn = this.cfg.appwrite.checkpointFunctionId;
    if (!fn) return false;
    await call(() => new Functions(this.admin).createExecution({ functionId: fn, async: true, body: JSON.stringify({ space: spaceKey }) }));
    return true;
  }
  async notifyTamper(args: { spaceKey: string; spaceName: string; ownerId?: string; message: string }) {
    if (!args.ownerId || !bool("ENGRAM_ALERT_EMAILS", false)) return;
    try {
      // Addressed to the user, so Appwrite Messaging sends it to the account's email target.
      await new Messaging(this.admin).createEmail({
        messageId: ID.unique(),
        subject: `Engram integrity alert: ${args.spaceName}`,
        // Without a configured public URL the link is left out rather than pointed at localhost.
        content: `${args.message}${this.cfg.appUrl ? `\n\nOpen ${this.cfg.appUrl}/app/${args.spaceKey}/chain to inspect the chain.` : ""}`,
        users: [args.ownerId],
      });
    } catch (e) {
      console.error("[engram] alert email failed", e);
    }
  }
}

export function createAppwriteBackend(cfg: EngramConfig): Backend {
  const { endpoint, projectId, apiKey, databaseId } = cfg.appwrite;
  if (!endpoint || !projectId || !apiKey) {
    throw new EngramError("unavailable", "Appwrite is not configured: set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY.");
  }
  const admin = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return {
    kind: "appwrite",
    vectors: new AppwriteVectors(new VectorsDB(admin), databaseId, cfg),
    embedder: new AppwriteEmbedder(new Embeddings(admin)),
    teams: new AppwriteTeams(new Teams(admin), new Users(admin)),
    files: new AppwriteFiles(new Storage(admin)),
    auth: new AppwriteAuth(cfg, admin),
    jobs: new AppwriteJobs(cfg, admin),
    teamRead: (teamId) => [`read("team:${teamId}")`],
    publicRead: () => [`read("any")`],
  };
}
