/**
 * Local backend: a single-process store persisted to a JSON file. It powers the
 * test suite and offline development (`ENGRAM_BACKEND=local`) with the same
 * semantics the engine relies on in Appwrite: unique document IDs, atomic
 * batches, string filters and cosine search.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "@engram/core";
import { ConflictError, EngramError } from "../errors";
import { evaluate } from "./query";
import type {
  AuthStore, Backend, Collection, Embedder, EmbedModel, FileInfo, FileStore, Jobs, QuerySpec, TeamInfo, TeamStore, TxOp, User, VDoc, VectorStore,
} from "./types";

interface Db {
  docs: Record<Collection, Record<string, VDoc>>;
  teams: Record<string, { name: string; prefs: object; members: Record<string, string[]> }>;
  files: Record<string, Record<string, { name: string; createdAt: string; b64: string }>>;
  users: Record<string, { email: string; name: string; hash: string; salt: string }>;
  sessions: Record<string, { userId: string; expire: string }>;
}

const emptyDb = (): Db => ({ docs: { memories: {}, concepts: {}, agents: {}, recalls: {} }, teams: {}, files: {}, users: {}, sessions: {} });

export class LocalState {
  db: Db;
  constructor(private file: string | null) {
    this.db = emptyDb();
    if (file && existsSync(file)) {
      try { this.db = { ...emptyDb(), ...JSON.parse(readFileSync(file, "utf8")) }; } catch { /* start fresh */ }
    }
  }
  save() {
    if (!this.file) return;
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.db));
    renameSync(tmp, this.file);
  }
}

const now = () => new Date().toISOString();
const clone = <T>(x: T): T => structuredClone(x);

class LocalVectors implements VectorStore {
  constructor(private s: LocalState) {}
  private coll(c: Collection) { return this.s.db.docs[c]; }
  async create<M>(c: Collection, id: string, data: { embeddings: number[]; metadata: M }): Promise<VDoc<M>> {
    if (this.coll(c)[id]) throw new ConflictError(`Document with the requested ID already exists: ${id}`);
    const t = now();
    const doc: VDoc<M> = { $id: id, $createdAt: t, $updatedAt: t, embeddings: [...data.embeddings], metadata: clone(data.metadata) };
    this.coll(c)[id] = doc;
    this.s.save();
    return clone(doc);
  }
  async get<M>(c: Collection, id: string) { const d = this.coll(c)[id]; return d ? (clone(d) as VDoc<M>) : null; }
  async update<M>(c: Collection, id: string, data: { embeddings?: number[]; metadata?: M }): Promise<VDoc<M>> {
    const d = this.coll(c)[id];
    if (!d) throw new EngramError("not_found", `Document not found: ${id}`);
    if (data.embeddings) d.embeddings = [...data.embeddings];
    if (data.metadata !== undefined) d.metadata = clone(data.metadata);
    d.$updatedAt = now();
    this.s.save();
    return clone(d) as VDoc<M>;
  }
  async delete(c: Collection, id: string) { delete this.coll(c)[id]; this.s.save(); }
  async query<M>(c: Collection, q: QuerySpec): Promise<VDoc<M>[]> {
    return clone(evaluate(Object.values(this.coll(c)) as VDoc<M>[], q));
  }
  async transact(ops: TxOp[]) {
    for (const op of ops) {
      if (op.action === "create" && this.coll(op.coll)[op.id]) throw new ConflictError(`Document with the requested ID already exists: ${op.id}`);
      if (op.action === "update" && !this.coll(op.coll)[op.id]) throw new EngramError("not_found", `Document not found: ${op.id}`);
    }
    const t = now();
    for (const op of ops) {
      const coll = this.coll(op.coll);
      if (op.action === "create") coll[op.id] = { $id: op.id, $createdAt: t, $updatedAt: t, embeddings: [...op.data.embeddings], metadata: clone(op.data.metadata) };
      else if (op.action === "update") {
        const d = coll[op.id];
        if (op.data.embeddings) d.embeddings = [...op.data.embeddings];
        if (op.data.metadata !== undefined) d.metadata = clone(op.data.metadata);
        d.$updatedAt = t;
      } else delete coll[op.id];
    }
    this.s.save();
  }
}

/**
 * Deterministic hashing embedder for offline use: word unigrams, bigrams and
 * character trigrams, signed-hashed into the target dimension. It captures
 * lexical overlap, which is enough to exercise every code path.
 */
export class HashEmbedder implements Embedder {
  async embed(texts: string[], model: EmbedModel): Promise<number[][]> {
    const dim = model === "all-minilm" ? 384 : 768;
    return texts.map((t) => hashEmbed(t, dim));
  }
}

const STOP = new Set("a an the is are was were be been of to in on at for and or by with from as it its this that these those i you we they he she his her their our your my me do does did what who how when where which should can could would will".split(" "));
const stem = (w: string) => w.replace(/'s$/, "").replace(/(ing|ed|es|s)$/, (m) => (w.length > 4 ? "" : m));

export function hashEmbed(text: string, dim: number): number[] {
  const clean = text.replace(/^(search_query|search_document|clustering|classification):\s*/, "").toLowerCase();
  const words = clean.split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);
  const v = new Array<number>(dim).fill(0);
  const add = (tok: string, w: number) => {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
    const idx = (h >>> 0) % (dim - 1) + 1; // never touch index 0, reserved by the tombstone
    v[idx] += (h & 0x80000000 ? -1 : 1) * w;
  };
  words.forEach((w, i) => {
    add("w:" + w, 1);
    if (i > 0) add("b:" + words[i - 1] + "_" + w, 0.5);
    const p = `#${w}#`;
    for (let j = 0; j + 3 <= p.length; j++) add("c:" + p.slice(j, j + 3), 0.25);
  });
  if (!words.length) add("w:<empty>", 1);
  return normalize(v).map((x) => Math.round(x * 1e5) / 1e5);
}

class LocalTeams implements TeamStore {
  constructor(private s: LocalState) {}
  async create(teamId: string, name: string) {
    if (this.s.db.teams[teamId]) throw new ConflictError("team exists");
    this.s.db.teams[teamId] = { name, prefs: {}, members: {} };
    this.s.save();
  }
  async delete(teamId: string) { delete this.s.db.teams[teamId]; this.s.save(); }
  async rename(teamId: string, name: string) { const t = this.s.db.teams[teamId]; if (t) { t.name = name; this.s.save(); } }
  async getPrefs<P extends object>(teamId: string) { const t = this.s.db.teams[teamId]; return t ? (clone(t.prefs) as P) : null; }
  async updatePrefs<P extends object>(teamId: string, prefs: P) {
    const t = this.s.db.teams[teamId];
    if (!t) throw new EngramError("not_found", "space not found");
    t.prefs = clone(prefs);
    this.s.save();
  }
  async addMember(teamId: string, userId: string, roles: string[]) {
    const t = this.s.db.teams[teamId];
    if (!t) throw new EngramError("not_found", "space not found");
    t.members[userId] = roles;
    this.s.save();
  }
  async membership(teamId: string, userId: string) {
    const roles = this.s.db.teams[teamId]?.members[userId];
    return roles ? { roles } : null;
  }
  async listForUser(userId: string): Promise<TeamInfo[]> {
    return Object.entries(this.s.db.teams).filter(([, t]) => t.members[userId]).map(([teamId, t]) => ({ teamId, name: t.name, roles: t.members[userId] }));
  }
  async listAll(prefix: string) {
    return Object.entries(this.s.db.teams).filter(([id]) => id.startsWith(prefix)).map(([teamId, t]) => ({ teamId, name: t.name }));
  }
}

class LocalFiles implements FileStore {
  constructor(private s: LocalState) {}
  async put(bucket: string, fileId: string, name: string, bytes: Uint8Array) {
    const b = (this.s.db.files[bucket] ??= {});
    if (b[fileId]) throw new ConflictError("file exists");
    b[fileId] = { name, createdAt: now(), b64: Buffer.from(bytes).toString("base64") };
    this.s.save();
  }
  async get(bucket: string, fileId: string) {
    const f = this.s.db.files[bucket]?.[fileId];
    return f ? new Uint8Array(Buffer.from(f.b64, "base64")) : null;
  }
  async list(bucket: string, namePrefix: string): Promise<FileInfo[]> {
    return Object.entries(this.s.db.files[bucket] ?? {})
      .filter(([, f]) => f.name.startsWith(namePrefix))
      .map(([fileId, f]) => ({ fileId, name: f.name, createdAt: f.createdAt, size: Math.floor((f.b64.length * 3) / 4) }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }
  async delete(bucket: string, fileId: string) { delete this.s.db.files[bucket]?.[fileId]; this.s.save(); }
}

class LocalAuth implements AuthStore {
  constructor(private s: LocalState) {}
  async signUp(email: string, password: string, name: string): Promise<User> {
    email = email.toLowerCase();
    if (Object.values(this.s.db.users).some((u) => u.email === email)) throw new EngramError("conflict", "An account with this email already exists.");
    if (password.length < 8) throw new EngramError("bad_request", "Password must be at least 8 characters.");
    const id = "u" + randomBytes(9).toString("hex");
    const salt = randomBytes(16).toString("hex");
    this.s.db.users[id] = { email, name, salt, hash: scryptSync(password, salt, 32).toString("hex") };
    this.s.save();
    return { id, email, name };
  }
  async signIn(email: string, password: string) {
    email = email.toLowerCase();
    const entry = Object.entries(this.s.db.users).find(([, u]) => u.email === email);
    const ok = entry && timingSafeEqual(Buffer.from(entry[1].hash, "hex"), scryptSync(password, entry[1].salt, 32));
    if (!entry || !ok) throw new EngramError("unauthorized", "Invalid email or password.");
    const secret = randomBytes(32).toString("hex");
    const expire = new Date(Date.now() + 30 * 86_400_000).toISOString();
    this.s.db.sessions[secret] = { userId: entry[0], expire };
    this.s.save();
    return { secret, userId: entry[0], expire };
  }
  async getUser(secret: string): Promise<User | null> {
    const s = this.s.db.sessions[secret];
    if (!s || s.expire < now()) return null;
    const u = this.s.db.users[s.userId];
    return u ? { id: s.userId, email: u.email, name: u.name } : null;
  }
  async signOut(secret: string) { delete this.s.db.sessions[secret]; this.s.save(); }
  async createJwt() { return null; }
}

class LocalJobs implements Jobs {
  async triggerCheckpoint() { return false; }
  async notifyTamper(args: { spaceKey: string; message: string }) {
    console.warn(`[engram] integrity alert for ${args.spaceKey}: ${args.message}`);
  }
}

export function createLocalBackend(opts: { dir?: string | null } = {}): Backend {
  let file: string | null = null;
  if (opts.dir) {
    mkdirSync(opts.dir, { recursive: true });
    file = join(opts.dir, "db.json");
  }
  const s = new LocalState(file);
  return {
    kind: "local",
    vectors: new LocalVectors(s),
    embedder: new HashEmbedder(),
    teams: new LocalTeams(s),
    files: new LocalFiles(s),
    auth: new LocalAuth(s),
    jobs: new LocalJobs(),
    teamRead: (teamId) => [`read("team:${teamId}")`],
    publicRead: () => [`read("any")`],
  };
}
