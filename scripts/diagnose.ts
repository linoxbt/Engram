/**
 * Read-only diagnostics for a live project: how Storage answers the file listings the engine uses, and the
 * Functions' recent executions. Prints JSON. Run inside provisioning (ENGRAM_PROVISION_STEPS=diagnose).
 * The space checked is ENGRAM_DIAGNOSE_SPACE, else DEMO_SPACE / NEXT_PUBLIC_DEMO_SPACE; without one, only the
 * bucket-wide listing and the executions are reported.
 */
import "./env";
import { Client, Functions, Query, Storage } from "node-appwrite";
import { checkpointProblem } from "@engram/core";
import { createAppwriteBackend, getConfig, loadCheckpoints } from "@engram/server";

const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT!).setProject(process.env.APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!);
const storage = new Storage(client), fns = new Functions(client);
const bucket = process.env.APPWRITE_CHECKPOINTS_BUCKET ?? "checkpoints";
const space = [process.env.ENGRAM_DIAGNOSE_SPACE, process.env.DEMO_SPACE, process.env.NEXT_PUBLIC_DEMO_SPACE].find((s) => s && /^[a-z0-9]{8}$/.test(s)) ?? null;
const prefix = `cp_${space}_`;
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const names = (r: { total: number; files: { $id: string; name: string }[] }) => ({ total: r.total, sample: r.files.slice(0, 5).map((f) => `${f.$id} | ${f.name}`) });
const out: Record<string, unknown> = {};

const tryList = async (label: string, args: { bucketId: string; queries?: string[]; search?: string }) => {
  out[label] = await storage.listFiles(args).then(names, err);
};
out.space = space ?? "none (set ENGRAM_DIAGNOSE_SPACE or NEXT_PUBLIC_DEMO_SPACE)";
await tryList("plain", { bucketId: bucket, queries: [Query.limit(25)] });
if (space) {
  await tryList("startsWith name", { bucketId: bucket, queries: [Query.startsWith("name", prefix), Query.limit(25)] });
  await tryList("startsWith name + orderAsc $id", { bucketId: bucket, queries: [Query.startsWith("name", prefix), Query.limit(25), Query.orderAsc("$id")] });
  await tryList("startsWith $id", { bucketId: bucket, queries: [Query.startsWith("$id", prefix), Query.limit(25)] });
  await tryList("search", { bucketId: bucket, search: prefix, queries: [Query.limit(25)] });
  const listed = await storage.listFiles({ bucketId: bucket, queries: [Query.startsWith("name", prefix), Query.orderDesc("$id"), Query.limit(1)] }).catch(() => null);
  const latestId = listed?.files[0]?.$id;
  out.getLatest = latestId ? await storage.getFile({ bucketId: bucket, fileId: latestId }).then((f) => `${f.$id} | ${f.name} | ${f.sizeOriginal} B`, err) : "no checkpoint file found";

  // The engine's own path: list, download, parse, validate.
  {
    const b = createAppwriteBackend(getConfig());
    const files = await b.files.list(bucket, prefix).catch((e) => err(e));
    out.engineList = Array.isArray(files) ? files.map((f) => f.fileId) : files;
    if (Array.isArray(files) && files.length) {
      const bytes = await b.files.get(bucket, files[0].fileId).catch((e) => err(e));
      if (typeof bytes === "string") out.engineGet = bytes;
      else if (!bytes) out.engineGet = "null";
      else {
        const text = new TextDecoder().decode(bytes);
        out.engineGet = { length: bytes.length, head: text.slice(0, 160) };
        try { out.engineProblem = checkpointProblem(JSON.parse(text), space) ?? "none"; } catch (e) { out.engineProblem = `parse: ${err(e)}`; }
      }
    }
    out.engineLoad = await loadCheckpoints(b, space).then((c) => c.length, err);
    if (Array.isArray(files) && files.length) {
      const fileId = files[0].fileId;
      const len = (x: unknown) => (x instanceof ArrayBuffer ? x.byteLength : x && typeof x === "object" && "length" in x ? (x as { length: number }).length : typeof x);
      out.sdkDownload = await storage.getFileDownload({ bucketId: bucket, fileId }).then(len, err);
      out.sdkView = await storage.getFileView({ bucketId: bucket, fileId }).then(len, err);
      for (const kind of ["download", "view"]) {
        const res = await fetch(`${process.env.APPWRITE_ENDPOINT}/storage/buckets/${bucket}/files/${fileId}/${kind}`, {
          headers: { "X-Appwrite-Project": process.env.APPWRITE_PROJECT_ID!, "X-Appwrite-Key": process.env.APPWRITE_API_KEY! }, redirect: "manual",
        }).catch((e) => err(e));
        if (typeof res === "string") { out[`raw_${kind}`] = res; continue; }
        const body = await res.arrayBuffer();
        out[`raw_${kind}`] = { status: res.status, type: res.headers.get("content-type"), location: res.headers.get("location"), encoding: res.headers.get("content-encoding"), length: body.byteLength, head: new TextDecoder().decode(body).slice(0, 80) };
      }
    }
  }
}

const executions: Record<string, unknown> = {};
for (const id of ["checkpoint", "sentinel", "labeler", "reflect"]) {
  executions[id] = await fns.listExecutions({ functionId: id, queries: [Query.limit(4), Query.orderDesc("$createdAt")] }).then(
    (r) => r.executions.map((e) => ({ at: e.$createdAt, trigger: e.trigger, status: e.status, code: e.responseStatusCode, ms: Math.round(e.duration * 1000), errors: e.errors?.slice(-2000), logs: e.logs?.slice(-3000) })),
    err,
  );
}
out.executions = executions;
console.log(JSON.stringify(out, null, 2));
