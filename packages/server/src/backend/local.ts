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
import { ConflictError, EngramError, REAUTH_WINDOW_MS, reauthRequired } from "../errors";
import { evaluate } from "./query";
import { afterFailure, assertNotLocked, type LoginFails } from "./login-guard";
import type {
  AuthStore, Backend, Collection, Embedder, EmbedModel, FileInfo, FileStore, Jobs, PasskeyChallenge, PasskeyInfo, QuerySpec, TeamInfo, TeamStore, TxOp,
  User, VDoc, VectorStore,
} from "./types";

interface Db {
  docs: Record<Collection, Record<string, VDoc>>;
  teams: Record<string, { name: string; prefs: object; members: Record<string, string[]> }>;
  files: Record<string, Record<string, { name: string; createdAt: string; b64: string }>>;
  users: Record<string, { email: string; name: string; hash: string; salt: string; verified?: boolean }>;
  /** One-time recovery and verification tokens, keyed by secret. */
  tokens?: Record<string, { userId: string; kind: "recovery" | "verify"; expire: string }>;
  sessions: Record<string, { userId: string; expire: string; createdAt?: string }>;
  passkeys?: Record<string, { userId: string; name: string; credentialId: string; publicKey: string; counter: number; transports?: string[]; createdAt: string; accessedAt: string | null }>;
  /** Pending WebAuthn ceremonies: single use, five minutes. */
  passkeyChallenges?: Record<string, { kind: "register" | "signin"; challenge: string; expire: string; userId?: string; passkeyId?: string; name?: string }>;
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
/** Strictly increasing per document, so `ifUpdatedAt` detects every intervening write. */
const nextStamp = (prev?: string) => {
  const t = Date.now();
  const p = prev ? Date.parse(prev) : 0;
  return new Date(Math.max(t, p + 1)).toISOString();
};
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
  async update<M>(c: Collection, id: string, data: { embeddings?: number[]; metadata?: M }, _perms?: string[], opts: { ifUpdatedAt?: string } = {}): Promise<VDoc<M>> {
    const d = this.coll(c)[id];
    if (!d) throw new EngramError("not_found", `Document not found: ${id}`);
    if (opts.ifUpdatedAt && d.$updatedAt !== opts.ifUpdatedAt) throw new ConflictError(`Document ${id} changed since it was read`);
    if (data.embeddings) d.embeddings = [...data.embeddings];
    if (data.metadata !== undefined) d.metadata = clone(data.metadata);
    d.$updatedAt = nextStamp(d.$updatedAt);
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
      if (op.action === "update" && op.ifUpdatedAt && this.coll(op.coll)[op.id].$updatedAt !== op.ifUpdatedAt) throw new ConflictError(`Document ${op.id} changed since it was read`);
    }
    const t = now();
    for (const op of ops) {
      const coll = this.coll(op.coll);
      if (op.action === "create") coll[op.id] = { $id: op.id, $createdAt: t, $updatedAt: t, embeddings: [...op.data.embeddings], metadata: clone(op.data.metadata) };
      else if (op.action === "update") {
        const d = coll[op.id];
        if (op.data.embeddings) d.embeddings = [...op.data.embeddings];
        if (op.data.metadata !== undefined) d.metadata = clone(op.data.metadata);
        d.$updatedAt = nextStamp(d.$updatedAt);
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
  private loginFails = new Map<string, LoginFails>();
  async signIn(email: string, password: string) {
    email = email.toLowerCase();
    assertNotLocked(this.loginFails.get(email));
    const entry = Object.entries(this.s.db.users).find(([, u]) => u.email === email);
    // Hash even for unknown addresses, so response time does not reveal which accounts exist.
    const derived = scryptSync(password, entry?.[1].salt ?? "engram-timing-pad", 32);
    const ok = entry && timingSafeEqual(Buffer.from(entry[1].hash, "hex"), derived);
    if (!entry || !ok) {
      if (entry) this.loginFails.set(email, afterFailure(this.loginFails.get(email)));
      throw new EngramError("unauthorized", "Invalid email or password.");
    }
    this.loginFails.delete(email);
    return this.newSession(entry[0]);
  }
  private newSession(userId: string) {
    const secret = randomBytes(32).toString("hex");
    const expire = new Date(Date.now() + 30 * 86_400_000).toISOString();
    this.s.db.sessions[secret] = { userId, expire, createdAt: now() };
    this.s.save();
    return { secret, userId, expire };
  }
  async getUser(secret: string): Promise<User | null> {
    const s = this.s.db.sessions[secret];
    if (!s || s.expire < now()) return null;
    const u = this.s.db.users[s.userId];
    return u ? { id: s.userId, email: u.email, name: u.name, emailVerified: !!u.verified } : null;
  }
  async signOut(secret: string) { delete this.s.db.sessions[secret]; this.s.save(); }
  async createJwt() { return null; }
  private token(userId: string, kind: "recovery" | "verify", hours: number) {
    const secret = randomBytes(24).toString("hex");
    (this.s.db.tokens ??= {})[secret] = { userId, kind, expire: new Date(Date.now() + hours * 3_600_000).toISOString() };
    this.s.save();
    return secret;
  }
  private useToken(userId: string, secret: string, kind: "recovery" | "verify", invalid: string) {
    const t = this.s.db.tokens?.[secret];
    if (!t || t.userId !== userId || t.kind !== kind || t.expire < now()) throw new EngramError("bad_request", invalid);
    delete this.s.db.tokens![secret];
  }
  private link(url: string, userId: string, secret: string) {
    const u = new URL(url);
    u.searchParams.set("userId", userId);
    u.searchParams.set("secret", secret);
    return u.toString();
  }
  async requestRecovery(email: string, url: string) {
    const e = Object.entries(this.s.db.users).find(([, u]) => u.email === email.toLowerCase());
    if (!e) return {};
    const devLink = this.link(url, e[0], this.token(e[0], "recovery", 1));
    console.info(`[engram] password reset link for ${e[1].email}: ${devLink}`);
    return { devLink };
  }
  async completeRecovery(userId: string, secret: string, password: string) {
    if (password.length < 8) throw new EngramError("bad_request", "Password must be at least 8 characters.");
    this.useToken(userId, secret, "recovery", "This reset link is invalid or has expired. Request a new one.");
    const u = this.s.db.users[userId];
    if (!u) throw new EngramError("bad_request", "This reset link is invalid or has expired. Request a new one.");
    u.salt = randomBytes(16).toString("hex");
    u.hash = scryptSync(password, u.salt, 32).toString("hex");
    this.loginFails.delete(u.email);
    // A reset signs the account out everywhere.
    for (const [k, v] of Object.entries(this.s.db.sessions)) if (v.userId === userId) delete this.s.db.sessions[k];
    this.s.save();
  }
  async requestVerification(sessionSecret: string, url: string) {
    const user = await this.getUser(sessionSecret);
    if (!user) throw new EngramError("unauthorized", "Sign in to continue.");
    const devLink = this.link(url, user.id, this.token(user.id, "verify", 24 * 7));
    console.info(`[engram] verification link for ${user.email}: ${devLink}`);
    return { devLink };
  }
  async completeVerification(userId: string, secret: string) {
    this.useToken(userId, secret, "verify", "This verification link is invalid or has expired. Send a new one from your account.");
    const u = this.s.db.users[userId];
    if (u) u.verified = true;
    this.s.save();
  }
  async updateName(sessionSecret: string, name: string): Promise<User> {
    const user = await this.getUser(sessionSecret);
    if (!user) throw new EngramError("unauthorized", "Sign in to continue.");
    this.s.db.users[user.id].name = name;
    this.s.save();
    return { ...user, name };
  }
  async updatePassword(sessionSecret: string, oldPassword: string, password: string) {
    const user = await this.getUser(sessionSecret);
    if (!user) throw new EngramError("unauthorized", "Sign in to continue.");
    const u = this.s.db.users[user.id];
    if (!timingSafeEqual(Buffer.from(u.hash, "hex"), scryptSync(oldPassword, u.salt, 32))) throw new EngramError("unauthorized", "Your current password is incorrect.");
    if (password.length < 8) throw new EngramError("bad_request", "Password must be at least 8 characters.");
    u.salt = randomBytes(16).toString("hex");
    u.hash = scryptSync(password, u.salt, 32).toString("hex");
    this.s.save();
  }
  async deleteUser(userId: string) {
    delete this.s.db.users[userId];
    for (const [k, p] of Object.entries(this.s.db.passkeys ?? {})) if (p.userId === userId) delete this.s.db.passkeys![k];
    for (const [k, v] of Object.entries(this.s.db.sessions)) if (v.userId === userId) delete this.s.db.sessions[k];
    for (const t of Object.values(this.s.db.teams)) delete t.members[userId];
    this.s.save();
  }
  // ---- passkeys: the same WebAuthn ceremonies Appwrite runs, verified with @simplewebauthn/server.
  private async sessionUser(secret: string, recent = false) {
    const sess = this.s.db.sessions[secret];
    const user = await this.getUser(secret);
    if (!sess || !user) throw new EngramError("unauthorized", "Sign in to continue.");
    if (recent && (!sess.createdAt || Date.now() - Date.parse(sess.createdAt) > REAUTH_WINDOW_MS)) throw reauthRequired();
    return user;
  }
  private challenge(id: string, kind: "register" | "signin") {
    const c = this.s.db.passkeyChallenges?.[id];
    if (c) delete this.s.db.passkeyChallenges![id];
    if (!c || c.kind !== kind || c.expire < now()) throw new EngramError("bad_request", "The passkey request expired. Try again.");
    return c;
  }
  private info(id: string): PasskeyInfo {
    const p = this.s.db.passkeys![id];
    return { id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.accessedAt };
  }
  async listPasskeys(sessionSecret: string): Promise<PasskeyInfo[]> {
    const user = await this.sessionUser(sessionSecret);
    return Object.entries(this.s.db.passkeys ?? {}).filter(([, p]) => p.userId === user.id).map(([id]) => this.info(id));
  }
  async startPasskeyRegistration(sessionSecret: string, name: string, origin: string): Promise<PasskeyChallenge> {
    const user = await this.sessionUser(sessionSecret, true);
    const { generateRegistrationOptions } = await import("@simplewebauthn/server");
    const mine = Object.values(this.s.db.passkeys ?? {}).filter((p) => p.userId === user.id);
    const publicKey = await generateRegistrationOptions({
      rpName: "Engram", rpID: new URL(origin).hostname, userName: user.email, userDisplayName: user.name, userID: new TextEncoder().encode(user.id),
      attestationType: "none", excludeCredentials: mine.map((p) => ({ id: p.credentialId, transports: p.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const id = randomBytes(12).toString("hex"), passkeyId = randomBytes(12).toString("hex"), expire = new Date(Date.now() + 5 * 60_000).toISOString();
    (this.s.db.passkeyChallenges ??= {})[id] = { kind: "register", challenge: publicKey.challenge, expire, userId: user.id, passkeyId, name };
    this.s.save();
    return { id, passkeyId, publicKey, expire };
  }
  async finishPasskeyRegistration(sessionSecret: string, passkeyId: string, credential: object, origin: string): Promise<PasskeyInfo> {
    const user = await this.sessionUser(sessionSecret);
    const id = Object.entries(this.s.db.passkeyChallenges ?? {}).find(([, c]) => c.kind === "register" && c.passkeyId === passkeyId && c.userId === user.id)?.[0];
    if (!id) throw new EngramError("bad_request", "The passkey request expired. Try again.");
    const c = this.challenge(id, "register");
    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    const r = await verifyRegistrationResponse({
      response: credential as never, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: new URL(origin).hostname, requireUserVerification: true,
    }).catch((e: unknown) => { throw new EngramError("bad_request", `The passkey could not be verified: ${e instanceof Error ? e.message : e}`); });
    if (!r.verified) throw new EngramError("bad_request", "The passkey could not be verified.");
    const cred = r.registrationInfo.credential;
    (this.s.db.passkeys ??= {})[passkeyId] = {
      userId: user.id, name: c.name ?? "Passkey", credentialId: cred.id, publicKey: Buffer.from(cred.publicKey).toString("base64url"),
      counter: cred.counter, transports: cred.transports, createdAt: now(), accessedAt: null,
    };
    this.s.save();
    return this.info(passkeyId);
  }
  async renamePasskey(sessionSecret: string, passkeyId: string, name: string): Promise<PasskeyInfo> {
    const user = await this.sessionUser(sessionSecret);
    const p = this.s.db.passkeys?.[passkeyId];
    if (!p || p.userId !== user.id) throw new EngramError("not_found", "Passkey not found.");
    p.name = name;
    this.s.save();
    return this.info(passkeyId);
  }
  async deletePasskey(sessionSecret: string, passkeyId: string) {
    const user = await this.sessionUser(sessionSecret, true);
    const p = this.s.db.passkeys?.[passkeyId];
    if (!p || p.userId !== user.id) throw new EngramError("not_found", "Passkey not found.");
    delete this.s.db.passkeys![passkeyId];
    this.s.save();
  }
  async startPasskeySignIn(origin: string): Promise<PasskeyChallenge> {
    const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
    const publicKey = await generateAuthenticationOptions({ rpID: new URL(origin).hostname, userVerification: "required" });
    const id = randomBytes(12).toString("hex"), expire = new Date(Date.now() + 5 * 60_000).toISOString();
    (this.s.db.passkeyChallenges ??= {})[id] = { kind: "signin", challenge: publicKey.challenge, expire };
    this.s.save();
    return { id, passkeyId: null, publicKey, expire };
  }
  async finishPasskeySignIn(challengeId: string, credential: object, origin: string) {
    const c = this.challenge(challengeId, "signin");
    const credId = (credential as { id?: unknown }).id;
    const entry = Object.entries(this.s.db.passkeys ?? {}).find(([, p]) => p.credentialId === credId);
    const fail = () => new EngramError("unauthorized", "That passkey could not be verified. Try again, or sign in with your password.");
    if (!entry || !this.s.db.users[entry[1].userId]) throw fail();
    const [pid, p] = entry;
    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    const r = await verifyAuthenticationResponse({
      response: credential as never, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: new URL(origin).hostname, requireUserVerification: true,
      credential: { id: p.credentialId, publicKey: new Uint8Array(Buffer.from(p.publicKey, "base64url")), counter: p.counter, transports: p.transports as never },
    }).catch(() => { throw fail(); });
    if (!r.verified) throw fail();
    p.counter = r.authenticationInfo.newCounter;
    p.accessedAt = now();
    this.s.db.passkeys![pid] = p;
    return this.newSession(p.userId);
  }
  async findUserByEmail(email: string): Promise<User | null> {
    const e = Object.entries(this.s.db.users).find(([, u]) => u.email === email.toLowerCase());
    return e ? { id: e[0], email: e[1].email, name: e[1].name } : null;
  }
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
