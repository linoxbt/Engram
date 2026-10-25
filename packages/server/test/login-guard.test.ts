/** Shared sign-in limits: create-first slots, per account+client and per account, safe under parallel guesses. */
import { describe, expect, it } from "vitest";
import { ConflictError, createLocalBackend, EngramError, type FileInfo, type FileStore } from "../src/index";
import { guardedSignIn, LOGIN_LIMITS, loginKeys, type AttemptStore } from "../src/backend/login-guard";

const outcome = (p: Promise<unknown>) => p.then(() => "ok", (e: EngramError) => (e.code === "rate_limited" ? "locked" : e.code));
const count = (xs: string[], x: string) => xs.filter((y) => y === x).length;

/** A storage double with random latency, so list/put calls interleave like separate server instances. */
function racyStore(): AttemptStore {
  const files = new Map<string, FileInfo>();
  const wait = () => new Promise((r) => setTimeout(r, Math.random() * 4));
  const store: FileStore = {
    async put(_b, fileId, name) { await wait(); if (files.has(fileId)) throw new ConflictError("exists"); files.set(fileId, { fileId, name, createdAt: new Date().toISOString(), size: 2 }); await wait(); },
    async get() { return null; },
    async list(_b, prefix) { await wait(); return [...files.values()].filter((f) => f.name.startsWith(prefix)); },
    async delete(_b, fileId) { await wait(); files.delete(fileId); },
  };
  return { files: store, bucket: "test" };
}

describe("sign-in limits", () => {
  it("parallel wrong guesses from one network never exceed the limit", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("par@example.com", "password123", "Par");
    const results = await Promise.all(Array.from({ length: 20 }, () => outcome(b.auth.signIn("par@example.com", "wrong-password", { client: "203.0.113.7" }))));
    expect(count(results, "unauthorized")).toBe(LOGIN_LIMITS.client.max);
    expect(count(results, "locked")).toBe(20 - LOGIN_LIMITS.client.max);
    // Locked for that network even with the right password, with a way out named...
    await expect(b.auth.signIn("par@example.com", "password123", { client: "203.0.113.7" })).rejects.toThrow(/Too many failed sign-ins.*passkey.*reset/);
    // ...but the owner signing in from elsewhere is not locked out by someone else's guessing.
    await expect(b.auth.signIn("par@example.com", "password123", { client: "198.51.100.1" })).resolves.toBeTruthy();
  });

  it("caps guessing spread across many networks per account", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("wide@example.com", "password123", "Wide");
    const results: string[] = [];
    for (let c = 0; c < 7; c++) {
      results.push(...await Promise.all(Array.from({ length: LOGIN_LIMITS.client.max }, () => outcome(b.auth.signIn("wide@example.com", "nope-nope", { client: `192.0.2.${c}` })))));
    }
    expect(count(results, "unauthorized")).toBe(LOGIN_LIMITS.account.max);
    await expect(b.auth.signIn("wide@example.com", "password123", { client: "192.0.2.200" })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("treats unknown addresses exactly like real ones", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("real@example.com", "password123", "Real");
    const real = await Promise.all(Array.from({ length: 10 }, () => outcome(b.auth.signIn("real@example.com", "wrong-password", { client: "x" }))));
    const ghost = await Promise.all(Array.from({ length: 10 }, () => outcome(b.auth.signIn("ghost@example.com", "wrong-password", { client: "x" }))));
    expect(ghost).toEqual(real);
  });

  it("passkey sign-in and a password reset still work while locked, and the reset lifts the lock", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("lock2@example.com", "password123", "Lock");
    for (let i = 0; i < LOGIN_LIMITS.client.max; i++) await outcome(b.auth.signIn("lock2@example.com", "bad-password"));
    await expect(b.auth.signIn("lock2@example.com", "password123")).rejects.toMatchObject({ code: "rate_limited" });
    await expect(b.auth.startPasskeySignIn("https://engram.example")).resolves.toMatchObject({ id: expect.any(String) });
    const { devLink } = await b.auth.requestRecovery("lock2@example.com", "https://engram.example/reset-password");
    const u = new URL(devLink!);
    await b.auth.completeRecovery(u.searchParams.get("userId")!, u.searchParams.get("secret")!, "new-password-1");
    await expect(b.auth.signIn("lock2@example.com", "new-password-1")).resolves.toBeTruthy();
  });

  it("a success gives back that network's slots", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("oops@example.com", "password123", "Oops");
    for (let i = 0; i < LOGIN_LIMITS.client.max - 1; i++) await outcome(b.auth.signIn("oops@example.com", "typo-password", { client: "c1" }));
    await b.auth.signIn("oops@example.com", "password123", { client: "c1" });
    const after = await Promise.all(Array.from({ length: LOGIN_LIMITS.client.max }, () => outcome(b.auth.signIn("oops@example.com", "typo-password", { client: "c1" }))));
    expect(count(after, "unauthorized")).toBe(LOGIN_LIMITS.client.max);
  });

  it("holds under racing instances, and outages do not count", async () => {
    const store = racyStore();
    const wrong = () => guardedSignIn(store, "race@example.com", "c", async () => { throw new EngramError("unauthorized", "Invalid email or password."); });
    const results = await Promise.all(Array.from({ length: 30 }, () => outcome(wrong())));
    expect(count(results, "unauthorized")).toBe(LOGIN_LIMITS.client.max);
    const other = racyStore();
    for (let i = 0; i < 20; i++) await outcome(guardedSignIn(other, "down@example.com", "c", async () => { throw new EngramError("unavailable", "Appwrite is down"); }));
    expect(await other.files.list("test", loginKeys("down@example.com", "c").account)).toEqual([]);
  });

  it("slot IDs fit Appwrite's 36-character file IDs", () => {
    const k = loginKeys("someone.with.a.long.address@example.com", "2001:db8:1:2::/64", Date.now());
    for (const p of [k.clientWindow, k.accountWindow]) expect((p + "49").length).toBeLessThanOrEqual(36);
    expect(k.clientWindow + "00").toMatch(/^[a-z0-9][a-z0-9_]+$/);
  });
});
