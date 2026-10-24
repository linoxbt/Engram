import { quantize } from "@engram/core";
import type { Ctx } from "./context";
import type { Backend } from "./backend/types";
import { getConfig } from "./config";

const cache = new Map<string, { v: number[]; at: number }>();
const TTL = 10 * 60_000;

/** nomic-embed-text expects task prefixes; Day 1 experiment 10 decides whether to keep them. */
const docText = (t: string) => (getConfig().embedPrefixes ? `search_document: ${t}` : t);
const queryText = (t: string) => (getConfig().embedPrefixes ? `search_query: ${t}` : t);

export async function embedDocuments(b: Backend, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const vs = await b.embedder.embed(texts.map(docText), "nomic-embed-text");
  return vs.map(quantize);
}
export const embedDocument = async (ctx: Pick<Ctx, "b">, text: string) => (await embedDocuments(ctx.b, [text]))[0];

/** Query embeddings are cached by normalised text for ten minutes. */
export async function embedQuery(ctx: Pick<Ctx, "b">, text: string): Promise<number[]> {
  const key = text.trim().toLowerCase().replace(/\s+/g, " ");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const [v] = await ctx.b.embedder.embed([queryText(text)], "nomic-embed-text");
  const q = quantize(v);
  cache.set(key, { v: q, at: Date.now() });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return q;
}

export async function embedAgentDescription(b: Backend, text: string): Promise<number[]> {
  const [v] = await b.embedder.embed([text], "all-minilm");
  return quantize(v);
}
