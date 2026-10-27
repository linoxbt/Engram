/**
 * The `events` provisioning step (pnpm experiments -- --events): which Realtime channel and which Function event
 * names fire for VectorsDB documents on this project. Both were "manual" in docs/verified.md items 11-12, and the
 * labeler had zero executions in production.
 *
 *  E1 Realtime: a throwaway user and JWT subscribe with the `appwrite` web SDK (Node 22's global WebSocket) to every
 *     candidate channel; a test document readable by that user is created; we record which subscriptions fired and
 *     the channel and event names Appwrite reported.
 *  E2 Functions: candidate event names are attached to the labeler one by one (an invalid name is rejected by the
 *     API, which is a result too), then all accepted ones at once; a test concept is created and updated; the
 *     labeler's executions show which event fired (x-appwrite-event). The original events are always restored.
 *
 * Every document uses the reserved test space key, carries permissions only for the throwaway user, and is deleted.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { AppwriteException, Client, Functions, ID, Query, Users, VectorsDB, type Models } from "node-appwrite";
import { entryId, tombstoneVector } from "@engram/core";
import type { Row } from "./verified-md";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof AppwriteException ? `${e.code} ${e.type || "error"}: ${e.message}` : e instanceof Error ? e.message : String(e));
const until = async (ms: number, done: () => boolean) => { const end = Date.now() + ms; while (Date.now() < end && !done()) await sleep(250); };

export interface EventsConfig { endpoint: string; project: string; key: string; db: string; space: string; labelerId: string; origin: string | null }
/** One labeler execution raised by an event. `event` is null when Appwrite logged no x-appwrite-event header. */
export interface FiredExecution { id: string; event: string | null; status: string }
export interface EventsResult { rows: Row[]; realtimeChannel: string | null; functionEvents: string[]; functionExecutions: FiredExecution[]; notes: string[] }

/** The slice of the `appwrite` web SDK used here (it is a dependency of apps/web, not of the scripts). */
interface WebSdk {
  Client: new () => { setEndpoint(e: string): WebSdkClient };
}
interface WebSdkClient {
  setEndpoint(e: string): WebSdkClient; setProject(p: string): WebSdkClient; setJWT(j: string): WebSdkClient;
  subscribe(channel: string, cb: (msg: { channels?: string[]; events?: string[] }) => void): unknown;
}

/** The web SDK reads `window` and `localStorage` as bare globals; give Node just enough of both. */
export async function loadWebSdk(origin: string | null) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.window) g.window = globalThis;
  if (!g.localStorage) { const m = new Map<string, string>(); g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) }; }
  // Appwrite checks a Realtime client's Origin against the project's web platforms; Node sends none by default.
  const Native = globalThis.WebSocket;
  if (!Native) throw new Error("this Node has no global WebSocket (need Node 22+)");
  if (origin && !(Native as unknown as { __engram?: boolean }).__engram) {
    class WithOrigin extends Native {
      static __engram = true;
      constructor(url: string | URL, protocols?: string | string[]) { super(url, { protocols, headers: { Origin: origin } } as unknown as string[]); }
    }
    g.WebSocket = WithOrigin;
  }
  const req = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const dir = dirname(req.resolve("appwrite/package.json"));
  return (await import(pathToFileURL(join(dir, "dist/esm/sdk.js")).href)) as WebSdk;
}

export function realtimeCandidates(db: string, coll: string, docId: string) {
  return [
    `databases.${db}.collections.${coll}.documents`,
    `vectorsdb.${db}.collections.${coll}.documents`,
    `databases.${db}.collections.${coll}.documents.${docId}`,
    `vectorsdb.${db}.collections.${coll}.documents.${docId}`,
    `tablesdb.${db}.tables.${coll}.rows`,
    "documents",
    "rows",
  ];
}

/**
 * The verdict for item 12. An execution with no x-appwrite-event header proves that *something* fired but not
 * which namespace did, so it is informational ("info"), not a yes: the earlier version reported "OK: yes" and then
 * interpolated the placeholder string where the namespace belonged.
 */
export function functionEventVerdict(fired: FiredExecution[]): { ok: boolean | null; names: string[]; action: string } {
  const names = [...new Set(fired.map((f) => f.event).filter((e): e is string => !!e))];
  if (names.length) return { ok: true, names, action: `Set the labeler's events in appwrite.json to the namespace that fired (${names[0].replace(/\.c_[a-z0-9]{8}_[a-z0-9]{6}\./, ".*.")})` };
  if (fired.length) {
    return {
      ok: null, names,
      action: "Executions fired but Appwrite logged no x-appwrite-event header, so which namespace delivered them is unproven: keep both databases.* and vectorsdb.* in appwrite.json, and read the namespace off a labeler execution in the console",
    };
  }
  return { ok: false, names, action: "Function events do not fire for VectorsDB here; the app labels inline at 3, 10, 30 and 100 members" };
}

export function functionEventCandidates(db: string, coll: string) {
  return [
    `databases.${db}.collections.${coll}.documents.*.create`,
    `databases.${db}.collections.${coll}.documents.*.update`,
    `vectorsdb.${db}.collections.${coll}.documents.*.create`,
    `vectorsdb.${db}.collections.${coll}.documents.*.update`,
    `databases.*.collections.*.documents.*.create`,
    `vectorsdb.*.collections.*.documents.*.create`,
    `databases.${db}.collections.${coll}.documents.*`,
    `vectorsdb.${db}.collections.${coll}.documents.*`,
  ];
}

async function realtime(cfg: EventsConfig, rows: Row[], notes: string[]): Promise<string | null> {
  const admin = new Client().setEndpoint(cfg.endpoint).setProject(cfg.project).setKey(cfg.key);
  const users = new Users(admin), vdb = new VectorsDB(admin);
  const docId = entryId(cfg.space, 900_000_000_000 + Math.floor(Math.random() * 1e9));
  const candidates = realtimeCandidates(cfg.db, "memories", docId);
  const fired = new Map<string, { channels: string[]; events: string[] }>();
  let userId: string | null = null;
  const unsubs: (() => void)[] = [];
  try {
    const sdk = await loadWebSdk(cfg.origin);
    const u = await users.create({ userId: ID.unique(), email: `rt-${cfg.space}-${Date.now()}@example.invalid`, password: ID.unique() + ID.unique(), name: "engram realtime probe" });
    userId = u.$id;
    const jwt = (await users.createJWT({ userId, duration: 900 })).jwt;
    const client = new sdk.Client().setEndpoint(cfg.endpoint).setProject(cfg.project).setJWT(jwt);
    for (const ch of candidates) {
      const r = client.subscribe(ch, (msg: { channels?: string[]; events?: string[] }) => {
        if (!fired.has(ch)) fired.set(ch, { channels: msg.channels ?? [], events: msg.events ?? [] });
      }) as unknown;
      const un = r instanceof Promise ? await r : r;
      if (typeof un === "function") unsubs.push(un as () => void);
      else if (un && typeof (un as { close?: unknown }).close === "function") unsubs.push(() => (un as { close: () => void }).close());
    }
    await sleep(4000); // connect, authenticate and subscribe
    await vdb.createDocument({ databaseId: cfg.db, collectionId: "memories", documentId: docId, data: { embeddings: tombstoneVector(768), metadata: { space: cfg.space, probe: "realtime" } } as never, permissions: [`read("user:${userId}")`] });
    await until(12_000, () => fired.size >= candidates.length);
    await vdb.updateDocument({ databaseId: cfg.db, collectionId: "memories", documentId: docId, data: { metadata: { space: cfg.space, probe: "realtime-update" } } as never });
    await sleep(3000);
  } catch (e) {
    notes.push(`Realtime probe error: ${errText(e)}`);
  } finally {
    for (const u of unsubs) { try { u(); } catch { /* closed */ } }
    await vdb.deleteDocument({ databaseId: cfg.db, collectionId: "memories", documentId: docId }).catch(() => undefined);
    if (userId) await users.delete({ userId }).catch(() => undefined);
  }
  const reported = [...new Set([...fired.values()].flatMap((f) => f.channels))];
  const events = [...new Set([...fired.values()].flatMap((f) => f.events))].filter((e) => !e.includes("*")).slice(0, 6);
  const specific = candidates.slice(0, 2).find((c) => fired.has(c)) ?? candidates.slice(2, 5).find((c) => fired.has(c)) ?? null;
  rows.push({
    n: 11, item: "Realtime channel for VectorsDB documents",
    ok: fired.size > 0,
    result: fired.size
      ? `fired: ${[...fired.keys()].join(", ")}; not fired: ${candidates.filter((c) => !fired.has(c)).join(", ") || "none"}; Appwrite reported channels ${reported.join(", ") || "none"}; events ${events.join(", ") || "none"}`
      : `no candidate channel fired (${candidates.join(", ")})${notes.length ? `; ${notes[notes.length - 1]}` : ""}`,
    action: specific ? `Subscribe to ${specific.replace(`.${docId}`, "")} (apps/web/lib/client/live.ts)` : "Keep 3-second polling; Realtime does not deliver VectorsDB document events here",
  });
  return specific ? specific.replace(`.${docId}`, "") : null;
}

async function functionEvents(cfg: EventsConfig, rows: Row[], notes: string[]): Promise<FiredExecution[]> {
  const admin = new Client().setEndpoint(cfg.endpoint).setProject(cfg.project).setKey(cfg.key);
  const fns = new Functions(admin), vdb = new VectorsDB(admin);
  let original: Models.Function;
  try { original = await fns.get({ functionId: cfg.labelerId }); }
  catch (e) {
    rows.push({ n: 12, item: "Function trigger on a VectorsDB document event", ok: false, result: `labeler Function not readable: ${errText(e)}`, action: "Deploy the Functions first (functions step), then run the events step" });
    return [];
  }
  const update = (events: string[]) => fns.update({ functionId: original.$id, name: original.name, runtime: original.runtime as never, execute: original.execute, events, timeout: original.timeout, enabled: original.enabled, logging: original.logging, entrypoint: original.entrypoint, commands: original.commands, scopes: original.scopes as never, interval: (original as { interval?: number }).interval ?? 0 } as never);
  const accepted: string[] = [], rejected: string[] = [];
  const conceptId = `c_${cfg.space}_${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
  const fired: FiredExecution[] = [];
  const t0 = new Date().toISOString();
  try {
    for (const ev of functionEventCandidates(cfg.db, "concepts")) {
      try { await update([ev]); accepted.push(ev); } catch (e) { rejected.push(`${ev} (${errText(e).slice(0, 80)})`); }
    }
    if (accepted.length) {
      await update(accepted);
      await sleep(2000);
      await vdb.createDocument({ databaseId: cfg.db, collectionId: "concepts", documentId: conceptId, data: { embeddings: tombstoneVector(768), metadata: { space: cfg.space, label: "", summary: "", members: "00000001", membersN: 1, labeledAtMembers: "00000000", probe: "events" } } as never, permissions: [] });
      await sleep(3000);
      await vdb.updateDocument({ databaseId: cfg.db, collectionId: "concepts", documentId: conceptId, data: { metadata: { space: cfg.space, label: "", summary: "", members: "00000002", membersN: 2, labeledAtMembers: "00000000", probe: "events-update" } } as never });
      const seen = new Set<string>();
      for (let i = 0; i < 12 && fired.length < 2; i++) {
        const list = await fns.listExecutions({ functionId: original.$id, queries: [Query.orderDesc("$createdAt"), Query.limit(25)] }).catch(() => null);
        for (const x of list?.executions ?? []) {
          if (seen.has(x.$id) || x.$createdAt < t0) continue;
          seen.add(x.$id);
          const ev = x.requestHeaders?.find((h) => h.name.toLowerCase() === "x-appwrite-event")?.value;
          if (String(x.trigger) === "event") fired.push({ id: x.$id, event: ev ?? null, status: x.status });
        }
        if (fired.length < 2) await sleep(5000);
      }
    }
  } catch (e) {
    notes.push(`Function event probe error: ${errText(e)}`);
  } finally {
    await update(original.events).catch((e) => notes.push(`COULD NOT RESTORE labeler events (${original.events.join(", ")}): ${errText(e)}`));
    await vdb.deleteDocument({ databaseId: cfg.db, collectionId: "concepts", documentId: conceptId }).catch(() => undefined);
  }
  const verdict = functionEventVerdict(fired);
  rows.push({
    n: 12, item: "Function trigger on a VectorsDB document event",
    ok: verdict.ok,
    result: `accepted names: ${accepted.join(", ") || "none"}; rejected: ${rejected.join("; ") || "none"}; fired: ${fired.map((f) => `${f.event ?? `execution ${f.id}, no x-appwrite-event header logged`} [${f.status}]`).join(", ") || "nothing within 60 s"}; labeler events restored to ${original.events.join(", ") || "none"}`,
    action: verdict.action,
  });
  return fired;
}

export async function runEventsExperiments(cfg: EventsConfig): Promise<EventsResult> {
  const rows: Row[] = [], notes: string[] = [];
  const realtimeChannel = await realtime(cfg, rows, notes);
  const fired = await functionEvents(cfg, rows, notes);
  return { rows, realtimeChannel, functionEvents: functionEventVerdict(fired).names, functionExecutions: fired, notes };
}
