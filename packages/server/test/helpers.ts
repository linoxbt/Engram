import { generateKeyPair } from "@engram/core";
import { createLocalBackend, createSpace, personCtx, setConfig, getConfig, type Backend, type Ctx } from "../src/index";

export async function setup(opts: { sandbox?: boolean } = {}) {
  const keys = await generateKeyPair();
  setConfig({ backend: "local", classifierModel: null, checkpoint: { privateKey: keys.privateKey, publicKey: keys.publicKey, keyId: "test" } });
  const b: Backend = createLocalBackend({ dir: null });
  const user = await b.auth.signUp(`t${Math.random().toString(36).slice(2)}@example.com`, "password123", "Tess");
  const space = await createSpace(b, { name: "Test", ownerId: user.id, ownerName: "Tess", sandbox: opts.sandbox, publicVerify: true });
  const tasks: Promise<unknown>[] = [];
  const ctx: Ctx = { ...personCtx(b, space, user), defer: (t) => { tasks.push(t()); } };
  const drain = async () => { while (tasks.length) await tasks.shift(); };
  return { b, user, space, ctx, keys, drain, cfg: getConfig() };
}
