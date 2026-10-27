/** The classifier model paths of the fourth audit's fixes: timeouts, the rule-based fallback, model verdicts. */
import { describe, expect, it, vi } from "vitest";
import { relate, remember, type Ctx, type Neighbour, type NewMemory } from "../src/index";
import { setup } from "./helpers";

const model = vi.hoisted(() => ({ mode: "timeout" as "timeout" | "answer", relation: "contradicts", calls: 0 }));

vi.mock("ai", async (orig) => {
  const real = await orig<typeof import("ai")>();
  return {
    ...real,
    generateText: vi.fn(async (args: { system?: string; prompt: string }) => {
      model.calls++;
      if (model.mode === "timeout") {
        // What AbortSignal.timeout produces: reachable but too slow.
        const e = new Error("The operation was aborted due to timeout");
        e.name = "TimeoutError";
        throw e;
      }
      const relations = [...args.prompt.matchAll(/^EXISTING \[(m_[a-z0-9]+_\d{12})\]/gm)]
        .map(([, id]) => ({ id, relation: model.relation, confidence: 0.9, reason: "The model decided." }));
      return { text: "", output: { relations } };
    }),
  };
});

const withModel = (ctx: Ctx): Ctx => ({ ...ctx, cfg: { ...ctx.cfg, classifierModel: "anthropic:claude-test", modelApiKey: "sk-ant-test" } });
const neighbour = (text: string): Neighbour => ({
  id: "m_testspace_000000000001", text, createdAt: "2026-10-20T10:00:00.000Z",
  agent: "agent:a", agentName: "agent-a", subject: "customer:ada", kind: "fact", distance: 0.3,
});
const mem = (text: string): NewMemory => ({
  text, kind: "fact", subject: "customer:ada", createdAt: "2026-10-21T10:00:00.000Z", agentName: "agent-a", agent: "agent:a",
});

describe("a model that is reachable but always slow", () => {
  const older = neighbour("Ada is on the Pro plan, billed monthly.");
  const newer = mem("Ada downgraded from the Pro plan to Basic on 22 October.");

  it("leaves the first, interactive pass pending but never the background retry", async () => {
    model.mode = "timeout";
    const ctx = withModel((await setup()).ctx);
    expect(await relate(ctx, newer, [older])).toMatchObject({ status: "pending", via: "model" });
    // The background retry asks for the rule-based fallback, and a timeout must honour it like any other failure.
    const retried = await relate(ctx, newer, [older], { fallback: true });
    expect(retried.status).toBe("done");
    expect(retried.via).toBe("heuristic");
    expect(retried.relations.map((r) => r.relation)).toEqual(["supersedes"]);
  });
});

describe("a write classified by the model", () => {
  it("records the model's verdict on the new entry", async () => {
    model.mode = "answer";
    model.relation = "contradicts";
    const { ctx, drain } = await setup();
    const c = withModel(ctx);
    const first = await remember(c, { text: "Ada is on the Pro plan, billed monthly.", subject: "customer:ada" });
    const second = await remember(c, { text: "Ada is on the Basic plan, billed yearly.", subject: "customer:ada" });
    await drain();
    expect(second.status).toBe("created");
    expect(second.relations).toEqual([{ id: first.id, seq: 0, relation: "contradicts", reason: "The model decided.", confidence: 0.9 }]);
  });
});
