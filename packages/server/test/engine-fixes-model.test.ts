/** With a classifier model configured, the demo story runs through the real relate path (the model is a stub here). */
import { describe, expect, it, vi } from "vitest";
import { getSpace, listConflicts, loadChain, notesOf, seedStory, type Ctx } from "../src/index";
import { setup } from "./helpers";

const model = vi.hoisted(() => ({ agree: true, prompts: [] as string[] }));

vi.mock("ai", async (orig) => {
  const real = await orig<typeof import("ai")>();
  return {
    ...real,
    generateText: vi.fn(async (args: { system?: string; prompt: string }) => {
      model.prompts.push(args.prompt);
      if (!args.system?.startsWith("You compare a NEW memory")) return { text: "", output: { label: "Cluster", summary: "A cluster." } };
      const isNew = (re: RegExp) => re.test(args.prompt.split("\n").find((l) => l.startsWith("NEW")) ?? "");
      const relations = [...args.prompt.matchAll(/^EXISTING \[(m_[a-z0-9]+_\d{12})\][^\n]*text ("(?:[^"\\]|\\.)*")$/gm)].map(([, id, json]) => {
        const text = JSON.parse(json) as string;
        if (model.agree && isNew(/downgraded/) && /Pro plan, billed monthly/.test(text)) return { id, relation: "supersedes", confidence: 0.95, reason: "The downgrade on 22 October replaces the Pro plan." };
        if (isNew(/account is on the Pro plan/) && /downgraded/.test(text)) return { id, relation: model.agree ? "contradicts" : "refines", confidence: 0.9, reason: "Billing says Pro; support recorded a downgrade to Basic." };
        return { id, relation: "unrelated", confidence: 0.9, reason: "Different facts." };
      });
      return { text: "", output: { relations } };
    }),
  };
});

const withModel = (ctx: Ctx): Ctx => ({ ...ctx, cfg: { ...ctx.cfg, classifierModel: "anthropic:claude-test", modelApiKey: "sk-ant-test" } });

describe("demo story with a classifier model", () => {
  it("uses the model's verdicts and reasons when they match the story", async () => {
    model.agree = true;
    const { b, ctx } = await setup();
    await seedStory(withModel(ctx), { variant: "demo", background: 0 });
    // The prompts the model saw delimit the story's text as untrusted data.
    expect(model.prompts.some((p) => p.startsWith("BEGIN UNTRUSTED DATA"))).toBe(true);
    const space = (await getSpace(b, ctx.space.key))!;
    const { pairs } = await listConflicts({ ...ctx, space });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ reason: "Billing says Pro; support recorded a downgrade to Basic.", via: "model" });
    const basic = (await loadChain(b, space.key)).find((e) => /downgraded/.test(e.metadata.c.text ?? ""))!;
    expect(Object.values(notesOf(basic.metadata.d))).toEqual([{ relation: "supersedes", reason: "The downgrade on 22 October replaces the Pro plan.", via: "model" }]);
  });

  it("falls back to the scripted relation, and says so, when the model disagrees", async () => {
    model.agree = false;
    const { b, ctx } = await setup();
    await seedStory(withModel(ctx), { variant: "demo", background: 0 });
    const space = (await getSpace(b, ctx.space.key))!;
    const { pairs } = await listConflicts({ ...ctx, space });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ reason: "Scripted in the demo story: two agents disagree.", via: "scripted" });
    const chain = await loadChain(b, space.key);
    expect(chain.filter((e) => e.metadata.d.status === "superseded")).toHaveLength(1);
  });
});
