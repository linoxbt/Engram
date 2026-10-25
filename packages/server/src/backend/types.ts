/** Storage interfaces. The engine depends only on these, never on a vendor SDK. */

export type Collection = "memories" | "concepts" | "agents" | "recalls";

export interface VDoc<M = any> {
  $id: string;
  $createdAt?: string;
  $updatedAt?: string;
  embeddings?: number[];
  metadata: M;
  /** Cosine distance, present on vector queries. */
  $distance?: number;
}

export type Scalar = string | null;
export type Filter =
  | { op: "eq"; path: string; values: Scalar[] }
  | { op: "ne"; path: string; value: Scalar }
  | { op: "lt" | "lte" | "gt" | "gte"; path: string; value: string }
  | { op: "isNull" | "isNotNull"; path: string }
  | { op: "contains"; path: string; value: string }
  | { op: "startsWith"; path: string; value: string };

export interface QuerySpec {
  filters?: Filter[];
  vector?: number[];
  order?: { field: "$id" | "$createdAt"; dir: "asc" | "desc" };
  limit?: number;
  cursorAfter?: string;
  /** Skip returning embeddings when the caller does not need them. */
  withVectors?: boolean;
}

export type TxOp =
  | { action: "create"; coll: Collection; id: string; data: { embeddings: number[]; metadata: unknown }; perms?: string[] }
  | { action: "update"; coll: Collection; id: string; data: { embeddings?: number[]; metadata?: unknown }; perms?: string[]; ifUpdatedAt?: string }
  | { action: "delete"; coll: Collection; id: string };

export interface VectorStore {
  create<M>(coll: Collection, id: string, data: { embeddings: number[]; metadata: M }, perms?: string[]): Promise<VDoc<M>>;
  get<M>(coll: Collection, id: string): Promise<VDoc<M> | null>;
  /** With `ifUpdatedAt`, the write only lands if the document is unchanged since that read (else ConflictError). */
  update<M>(coll: Collection, id: string, data: { embeddings?: number[]; metadata?: M }, perms?: string[], opts?: { ifUpdatedAt?: string }): Promise<VDoc<M>>;
  delete(coll: Collection, id: string): Promise<void>;
  query<M>(coll: Collection, q: QuerySpec): Promise<VDoc<M>[]>;
  /**
   * Atomic batch. Throws ConflictError when an update's `ifUpdatedAt` no longer
   * matches, or when a staged document changed before commit.
   */
  transact(ops: TxOp[]): Promise<void>;
}

export type EmbedModel = "nomic-embed-text" | "all-minilm";
export interface Embedder {
  embed(texts: string[], model: EmbedModel): Promise<number[][]>;
}

export interface TeamInfo { teamId: string; name: string; roles: string[] }
export interface TeamStore {
  create(teamId: string, name: string): Promise<void>;
  delete(teamId: string): Promise<void>;
  rename(teamId: string, name: string): Promise<void>;
  getPrefs<P extends object>(teamId: string): Promise<P | null>;
  updatePrefs<P extends object>(teamId: string, prefs: P): Promise<void>;
  addMember(teamId: string, userId: string, roles: string[]): Promise<void>;
  membership(teamId: string, userId: string): Promise<{ roles: string[] } | null>;
  listForUser(userId: string): Promise<TeamInfo[]>;
  listAll(prefix: string): Promise<{ teamId: string; name: string }[]>;
  /** Confirmed members only. */
  listMembers(teamId: string): Promise<TeamMember[]>;
  removeMember(teamId: string, userId: string): Promise<void>;
}

export interface TeamMember { userId: string; name: string; email: string; roles: string[]; joinedAt: string | null }

export interface FileInfo { fileId: string; name: string; createdAt: string; size: number }
export interface FileStore {
  put(bucket: string, fileId: string, name: string, bytes: Uint8Array, perms: string[]): Promise<void>;
  get(bucket: string, fileId: string): Promise<Uint8Array | null>;
  list(bucket: string, namePrefix: string): Promise<FileInfo[]>;
  delete(bucket: string, fileId: string): Promise<void>;
}

export interface User {
  id: string; email: string; name: string; emailVerified?: boolean;
  /**
   * When the account accepted the Terms; null when it never did through Engram (e.g. it was created directly
   * against Appwrite with the public project ID). Set only by the server (`acceptTerms`).
   */
  termsAcceptedAt?: string | null;
  /** A throwaway read-only demo account (POST /api/demo/enter), deleted after 24 hours. */
  guest?: boolean;
}

/** Demo guests live under a reserved domain that can never receive mail (RFC 2606). */
export const GUEST_EMAIL_DOMAIN = "guest.engram.invalid";
export const isGuestEmail = (email: string) => email.trim().toLowerCase().endsWith("@" + GUEST_EMAIL_DOMAIN);
/** Guests older than this are deleted. */
export const GUEST_TTL_MS = 24 * 3_600_000;

/**
 * Sign-up with an address that already has an account. Worded so it does not confirm the account to whoever is
 * asking; the request still fails, so a determined prober learns as much as from any sign-up form (rate-limited).
 */
export const SIGNUP_CONFLICT = "If you already have an account, sign in or reset your password.";
export interface AuthStore {
  signUp(email: string, password: string, name: string): Promise<User>;
  /**
   * Password sign-in under the shared attempt limits (backend/login-guard.ts). `client` identifies the caller's
   * network (IP, or IPv6 /64) so one attacker cannot lock the account's owner out; server-side re-authentication
   * passes none.
   */
  signIn(email: string, password: string, opts?: { client?: string }): Promise<{ secret: string; userId: string; expire: string }>;
  /** Null only when the session is invalid or expired; an outage throws (`unavailable`) instead of looking signed out. */
  getUser(secret: string): Promise<User | null>;
  signOut(secret: string): Promise<void>;
  /** A short-lived JWT the browser SDK can use for Realtime. Null when unsupported. */
  createJwt(secret: string): Promise<string | null>;
  /** Admin lookup for scripts (seeding). */
  findUserByEmail(email: string): Promise<User | null>;
  /**
   * Email a password-reset link pointing at `url`. Silent for unknown addresses, so the endpoint
   * cannot be used to discover accounts. The local backend cannot send email and returns the link.
   */
  requestRecovery(email: string, url: string): Promise<{ devLink?: string }>;
  completeRecovery(userId: string, secret: string, password: string): Promise<void>;
  /** Email a verification link to the signed-in user. The local backend returns the link instead. */
  requestVerification(sessionSecret: string, url: string): Promise<{ devLink?: string }>;
  completeVerification(userId: string, secret: string, sessionSecret: string | null): Promise<void>;
  updateName(sessionSecret: string, name: string): Promise<User>;
  /** Also ends every other session of the account; the one making the change stays signed in. */
  updatePassword(sessionSecret: string, oldPassword: string, password: string): Promise<void>;
  /** Permanently remove the account and every session it holds. */
  deleteUser(userId: string): Promise<void>;
  /**
   * Record that the account accepted the Terms, now: `termsAcceptedAt` in the user's prefs, plus (Appwrite) a
   * server-only "terms" label, since prefs are writable by the user through Appwrite directly and the label is not.
   */
  acceptTerms(userId: string): Promise<void>;
  /**
   * Passkeys (WebAuthn). Adding or removing one needs a session that signed in within the last 10 minutes
   * (otherwise `reauth_required`). `origin` is the site the browser is on: Appwrite takes the relying party
   * from its platform settings, the local backend from here.
   */
  listPasskeys(sessionSecret: string): Promise<PasskeyInfo[]>;
  startPasskeyRegistration(sessionSecret: string, name: string, origin: string): Promise<PasskeyChallenge>;
  finishPasskeyRegistration(sessionSecret: string, passkeyId: string, credential: object, origin: string): Promise<PasskeyInfo>;
  renamePasskey(sessionSecret: string, passkeyId: string, name: string): Promise<PasskeyInfo>;
  deletePasskey(sessionSecret: string, passkeyId: string): Promise<void>;
  startPasskeySignIn(origin: string): Promise<PasskeyChallenge>;
  finishPasskeySignIn(challengeId: string, credential: object, origin: string): Promise<{ secret: string; userId: string; expire: string }>;
}

export interface PasskeyInfo { id: string; name: string; createdAt: string; lastUsedAt: string | null }
/** WebAuthn options in JSON form, for `navigator.credentials.create()` (registration) or `.get()` (sign-in). */
export interface PasskeyChallenge { id: string; passkeyId: string | null; publicKey: object; expire: string }

export interface Jobs {
  /** Ask the checkpoint Function to run for a space. Returns false if no Function is configured. */
  triggerCheckpoint(spaceKey: string): Promise<boolean>;
  notifyTamper(args: { spaceKey: string; spaceName: string; ownerId?: string; message: string }): Promise<void>;
}

export interface Backend {
  kind: "appwrite" | "local";
  vectors: VectorStore;
  embedder: Embedder;
  teams: TeamStore;
  files: FileStore;
  auth: AuthStore;
  jobs: Jobs;
  /** Permission strings for a space's documents. */
  teamRead(teamId: string): string[];
  publicRead(): string[];
}
