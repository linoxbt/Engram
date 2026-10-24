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
  | { action: "update"; coll: Collection; id: string; data: { embeddings?: number[]; metadata?: unknown }; perms?: string[] }
  | { action: "delete"; coll: Collection; id: string };

export interface VectorStore {
  create<M>(coll: Collection, id: string, data: { embeddings: number[]; metadata: M }, perms?: string[]): Promise<VDoc<M>>;
  get<M>(coll: Collection, id: string): Promise<VDoc<M> | null>;
  update<M>(coll: Collection, id: string, data: { embeddings?: number[]; metadata?: M }, perms?: string[]): Promise<VDoc<M>>;
  delete(coll: Collection, id: string): Promise<void>;
  query<M>(coll: Collection, q: QuerySpec): Promise<VDoc<M>[]>;
  /** Atomic batch. Throws ConflictError when a staged document changed meanwhile. */
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
}

export interface FileInfo { fileId: string; name: string; createdAt: string; size: number }
export interface FileStore {
  put(bucket: string, fileId: string, name: string, bytes: Uint8Array, perms: string[]): Promise<void>;
  get(bucket: string, fileId: string): Promise<Uint8Array | null>;
  list(bucket: string, namePrefix: string): Promise<FileInfo[]>;
  delete(bucket: string, fileId: string): Promise<void>;
}

export interface User { id: string; email: string; name: string }
export interface AuthStore {
  signUp(email: string, password: string, name: string): Promise<User>;
  signIn(email: string, password: string): Promise<{ secret: string; userId: string; expire: string }>;
  getUser(secret: string): Promise<User | null>;
  signOut(secret: string): Promise<void>;
  /** A short-lived JWT the browser SDK can use for Realtime. Null when unsupported. */
  createJwt(secret: string): Promise<string | null>;
}

export interface Jobs {
  /** Ask the checkpoint Function to run for a space. Returns false if no Function is configured. */
  triggerCheckpoint(spaceKey: string): Promise<boolean>;
  notifyTamper(args: { spaceKey: string; spaceName: string; ownerEmail?: string; message: string }): Promise<void>;
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
