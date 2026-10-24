/** Appwrite backend: VectorsDB, Embeddings, Teams, Storage, Auth, Functions and Messaging. */
import {
  Account, AppwriteException, Client, Embeddings, EmbeddingModel, Functions, ID, Messaging, Query, Storage, Teams, Users, VectorsDB,
} from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import type { EngramConfig } from "../config";
import { ConflictError, EngramError, isEngramError } from "../errors";
import { evaluate } from "./query";
import { cosine } from "@engram/core";
import type {
  AuthStore, Backend, Collection, Embedder, EmbedModel, FileInfo, FileStore, Filter, Jobs, QuerySpec, TeamInfo, TeamStore, TxOp, User, VDoc, VectorStore,
} from "./types";

function mapError(e: unknown): unknown {
  if (e instanceof AppwriteException) {
    if (e.type === "database_not_found" || e.type === "collection_not_found") {
      return new EngramError("unavailable", "Engram's VectorsDB database is not provisioned yet. Enable dedicated databases on the Appwrite plan, then run `pnpm setup:appwrite`.");
    }
    if (e.code === 409) return new ConflictError(e.message);
    if (e.code === 404) return new EngramError("not_found", e.message);
    if (e.code === 402) return new EngramError("embeddings_unavailable", "Appwrite embeddings quota reached for this billing period.");
    if (e.code === 429) return new EngramError("rate_limited", "Appwrite rate limit reached. Try again shortly.");
  }
  return e;
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

class AppwriteVectors implements VectorStore {
  private selectOk = true;
  constructor(private vdb: VectorsDB, private db: string, private cfg: EngramConfig) {}

  async create<M>(coll: Collection, id: string, data: { embeddings: number[]; metadata: M }, perms?: string[]) {
    return call(() => this.vdb.createDocument({ databaseId: this.db, collectionId: coll, documentId: id, data: data as any, permissions: perms })) as unknown as Promise<VDoc<M>>;
  }
  async get<M>(coll: Collection, id: string): Promise<VDoc<M> | null> {
    try {
      return (await this.vdb.getDocument({ databaseId: this.db, collectionId: coll, documentId: id })) as unknown as VDoc<M>;
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
    return call(() => this.vdb.updateDocument({ databaseId: this.db, collectionId: coll, documentId: id, data: data as any, permissions: perms })) as unknown as Promise<VDoc<M>>;
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
      if (withSelect !== qs && e instanceof AppwriteException && e.code === 400) {
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
    return docs;
  }

  async transact(ops: TxOp[]) {
    if (!ops.length) return;
    const tx = await call(() => this.vdb.createTransaction({ ttl: 60 }));
    try {
      await this.vdb.createOperations({
        transactionId: tx.$id,
        operations: ops.map((op) => ({
          action: op.action,
          databaseId: this.db,
          collectionId: op.coll,
          documentId: op.id,
          ...(op.action === "delete" ? {} : { data: op.data }),
        })),
      });
      // Conditional updates: once staged, Appwrite's commit fails if a staged document changes.
      // Re-reading now closes the window between our read and the staging.
      for (const op of ops) {
        if (op.action !== "update" || !op.ifUpdatedAt) continue;
        const cur = await this.vdb.getDocument({ databaseId: this.db, collectionId: op.coll, documentId: op.id });
        if (cur.$updatedAt !== op.ifUpdatedAt) throw new ConflictError(`Document ${op.id} changed since it was read`);
      }
      await this.vdb.updateTransaction({ transactionId: tx.$id, commit: true });
    } catch (e) {
      try { await this.vdb.updateTransaction({ transactionId: tx.$id, rollback: true }); } catch { /* already closed */ }
      throw mapError(e);
    }
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
  async listForUser(userId: string): Promise<TeamInfo[]> {
    const res = await call(() => this.users.listMemberships({ userId, queries: [Query.limit(100)] }));
    return res.memberships.map((m) => ({ teamId: m.teamId, name: m.teamName, roles: m.roles }));
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
    try { return new Uint8Array(await this.storage.getFileDownload({ bucketId: bucket, fileId })); }
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
        catch (e) { if (e instanceof AppwriteException && e.code === 400) this.prefixOk = false; else throw mapError(e); }
      }
      // Fallback: full-text search, then filter by prefix below.
      if (!res) res = await call(() => this.storage.listFiles({ bucketId: bucket, queries: qs, search: namePrefix }));
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

class AppwriteAuth implements AuthStore {
  constructor(private cfg: EngramConfig, private admin: Client) {}
  private anon() { return new Client().setEndpoint(this.cfg.appwrite.endpoint).setProject(this.cfg.appwrite.projectId); }
  async signUp(email: string, password: string, name: string): Promise<User> {
    try {
      const u = await new Account(this.anon()).create({ userId: ID.unique(), email, password, name });
      return { id: u.$id, email: u.email, name: u.name };
    } catch (e) {
      // Same messages as the local backend; a bare 409 would otherwise read as a chain conflict.
      if (e instanceof AppwriteException && e.code === 409) throw new EngramError("conflict", "An account with this email already exists.");
      if (e instanceof AppwriteException && e.code === 400) throw new EngramError("bad_request", e.message);
      throw mapError(e);
    }
  }
  async signIn(email: string, password: string) {
    try {
      const s = await new Account(this.admin).createEmailPasswordSession({ email, password });
      return { secret: s.secret, userId: s.userId, expire: s.expire };
    } catch (e) {
      if (e instanceof AppwriteException && (e.code === 401 || e.code === 400)) throw new EngramError("unauthorized", "Invalid email or password.");
      throw mapError(e);
    }
  }
  async getUser(secret: string): Promise<User | null> {
    try {
      const u = await new Account(this.anon().setSession(secret)).get();
      return { id: u.$id, email: u.email, name: u.name, emailVerified: u.emailVerification };
    } catch { return null; }
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
    const u = await call(() => new Account(this.anon().setSession(sessionSecret)).updateName({ name }));
    return { id: u.$id, email: u.email, name: u.name, emailVerified: u.emailVerification };
  }
  async updatePassword(sessionSecret: string, oldPassword: string, password: string) {
    try {
      await new Account(this.anon().setSession(sessionSecret)).updatePassword({ password, oldPassword });
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 401) throw new EngramError("unauthorized", "Your current password is incorrect.");
      if (e instanceof AppwriteException && e.code === 400) throw new EngramError("bad_request", e.message);
      throw mapError(e);
    }
  }
  async deleteUser(userId: string) {
    await call(() => new Users(this.admin).delete({ userId }));
  }
  async createJwt(secret: string) {
    const u = await this.getUser(secret);
    if (!u) return null;
    try {
      const j = await new Users(this.admin).createJWT({ userId: u.id, duration: 3600 });
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
  async notifyTamper(args: { spaceKey: string; spaceName: string; ownerEmail?: string; message: string }) {
    if (!args.ownerEmail || process.env.ENGRAM_ALERT_EMAILS !== "true") return;
    try {
      await new Messaging(this.admin).createEmail({
        messageId: ID.unique(),
        subject: `Engram integrity alert: ${args.spaceName}`,
        content: `${args.message}\n\nOpen ${this.cfg.appUrl}/app/${args.spaceKey}/chain to inspect the chain.`,
        emails: [args.ownerEmail],
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
