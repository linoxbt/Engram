import { iso, type EntryMeta } from "@engram/core";
import { loadCheckpoints } from "./checkpoints";
import type { Ctx } from "./context";
import { getConfig } from "./config";

const PAGE = 200;

/**
 * Export a space as one JSON document, streamed straight to the person who asked: entries are read and sent one
 * page at a time, so memory use does not grow with the space. Nothing is stored: a kept copy would hold memory text
 * and salts beyond the reach of forget and deletion. Checkpoints are read first, so every exported checkpoint
 * covers only exported entries (the chain is append-only). A failure mid-way ends the stream early, which leaves
 * the JSON visibly incomplete rather than silently short.
 */
export function exportSpaceStream(ctx: Ctx, opts: { owner?: boolean } = {}): { stream: ReadableStream<Uint8Array>; exportedAt: string } {
  const exportedAt = iso();
  // Pending invites (token hashes) go only to the owner.
  const { people: _p, invites, ...rest } = ctx.space.settings;
  const settings = opts.owner ? { ...rest, invites } : rest;
  const head = { format: "engram-export-v1", exportedAt, space: ctx.space.key, settings, publicKey: getConfig().checkpoint.publicKey };
  const enc = new TextEncoder();
  let checkpoints: Awaited<ReturnType<typeof loadCheckpoints>> = [];
  let cursor: string | undefined;
  let phase: "head" | "entries" | "tail" = "head";
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    // Each pull must enqueue something (or close): a pull that returns empty-handed is not called again.
    async pull(controller) {
      if (phase === "head") {
        checkpoints = await loadCheckpoints(ctx.b, ctx.space.key);
        const h = JSON.stringify(head, null, 2);
        controller.enqueue(enc.encode(`${h.slice(0, h.lastIndexOf("\n}"))},\n  "entries": [`));
        phase = "entries";
        return;
      }
      if (phase === "entries") {
        const docs = await ctx.b.vectors.query<EntryMeta>("memories", {
          filters: [{ op: "eq", path: "metadata.space", values: [ctx.space.key] }],
          order: { field: "$id", dir: "asc" }, limit: PAGE, cursorAfter: cursor, withVectors: false,
        });
        if (docs.length < PAGE) phase = "tail";
        else cursor = docs[docs.length - 1].$id;
        if (docs.length) {
          controller.enqueue(enc.encode(docs.map((d) => `${sent++ ? "," : ""}\n    ${JSON.stringify({ id: d.$id, metadata: d.metadata })}`).join("")));
          return;
        }
      }
      controller.enqueue(enc.encode(`${sent ? "\n  " : ""}],\n  "checkpoints": ${JSON.stringify(checkpoints)}\n}\n`));
      controller.close();
    },
  });
  return { stream, exportedAt };
}

/** The whole export as an object (scripts and tests). */
export async function exportSpace(ctx: Ctx, opts: { owner?: boolean } = {}) {
  const text = await new Response(exportSpaceStream(ctx, opts).stream).text();
  return JSON.parse(text) as {
    format: "engram-export-v1"; exportedAt: string; space: string; settings: Record<string, unknown>; publicKey: string | null;
    entries: { id: string; metadata: EntryMeta }[]; checkpoints: Awaited<ReturnType<typeof loadCheckpoints>>;
  };
}
