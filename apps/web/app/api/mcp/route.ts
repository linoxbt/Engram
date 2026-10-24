import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import {
  authAgent, forget, formatForget, formatRecall, formatRemember, formatTimeline, formatVerify, getBackend, recall, remember,
  requireScope, resolveConflict, timeline, toErrorBody, verifyTool, ForgetInput, RecallInput, RememberInput, ResolveInput, TimelineInput,
} from "@engram/server";
import { defer } from "@/lib/server/api";
import {
  FORGET_DESCRIPTION, RECALL_DESCRIPTION, REMEMBER_DESCRIPTION, RESOLVE_DESCRIPTION, TIMELINE_DESCRIPTION, VERIFY_DESCRIPTION,
} from "@/lib/server/mcp-tools";

export const runtime = "nodejs";
export const maxDuration = 60;

type ToolCtx = { http?: { authInfo?: { token?: string } } };

async function ctxFrom(extra: unknown) {
  const token = (extra as ToolCtx)?.http?.authInfo?.token;
  return authAgent(getBackend(), token, defer);
}

function fail(e: unknown) {
  const { body } = toErrorBody(e);
  return { isError: true, content: [{ type: "text" as const, text: `${body.error.code}: ${body.error.message}` }] };
}

const ok = (text: string, data: unknown) => ({ content: [{ type: "text" as const, text }], structuredContent: data as Record<string, unknown> });

const handler = createMcpHandler(
  (server) => {
    server.registerTool("remember", { title: "Remember", description: REMEMBER_DESCRIPTION, inputSchema: RememberInput }, async (args, extra) => {
      try { const r = await remember(await ctxFrom(extra), args); return ok(formatRemember(r), r); } catch (e) { return fail(e); }
    });
    server.registerTool("recall", { title: "Recall", description: RECALL_DESCRIPTION, inputSchema: RecallInput }, async (args, extra) => {
      try { const r = await recall(await ctxFrom(extra), args); return ok(formatRecall(r), r); } catch (e) { return fail(e); }
    });
    server.registerTool("forget", { title: "Forget", description: FORGET_DESCRIPTION, inputSchema: ForgetInput }, async (args, extra) => {
      try { const r = await forget(await ctxFrom(extra), args); return ok(formatForget(r), r); } catch (e) { return fail(e); }
    });
    server.registerTool("timeline", { title: "Timeline", description: TIMELINE_DESCRIPTION, inputSchema: TimelineInput }, async (args, extra) => {
      try { const r = await timeline(await ctxFrom(extra), args); return ok(formatTimeline(r.subject, r.entries), r); } catch (e) { return fail(e); }
    });
    server.registerTool("verify", {
      title: "Verify",
      description: VERIFY_DESCRIPTION,
      inputSchema: z.object({ id: z.string().optional().describe("Memory ID for an inclusion proof"), mode: z.enum(["standard", "deep"]).default("standard") }),
    }, async (args, extra) => {
      try {
        const ctx = await ctxFrom(extra);
        requireScope(ctx, "verify");
        const r = await verifyTool(ctx, args);
        return ok(formatVerify(r as Parameters<typeof formatVerify>[0]), r);
      } catch (e) { return fail(e); }
    });
    server.registerTool("resolve", { title: "Resolve conflict", description: RESOLVE_DESCRIPTION, inputSchema: ResolveInput }, async (args, extra) => {
      try {
        const r = await resolveConflict(await ctxFrom(extra), args);
        return ok(`Recorded as entry #${r.seq}. ${r.action === "supersede" ? `#${Number(r.loser.slice(-12))} is now superseded by #${Number(r.winner.slice(-12))}.` : "The conflict is closed."}`, r);
      } catch (e) { return fail(e); }
    });
  },
  {
    serverInfo: { name: "engram", version: "1.0.0" },
    instructions: "Engram is verifiable shared memory. Call recall before answering questions about people, customers or projects; call remember for durable new facts; mention conflicts and superseded facts to the user.",
  },
);

const authed = withMcpAuth(handler, async (_req, token) => {
  if (!token) return undefined;
  const ctx = await authAgent(getBackend(), token, defer).catch(() => null);
  if (!ctx) return undefined;
  return { token, clientId: ctx.actor, scopes: ctx.scopes };
}, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
