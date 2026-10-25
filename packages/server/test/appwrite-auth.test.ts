/** The Appwrite auth adapter against stubbed SDK calls: sign-in limits, session checks and session clean-up. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, AppwriteException, Messaging, Storage, Users } from "node-appwrite";
import { createAppwriteBackend, getConfig, SIGNUP_CONFLICT } from "../src/index";
import { LOGIN_LIMITS } from "../src/backend/login-guard";

const backend = () => createAppwriteBackend({ ...getConfig(), appwrite: { ...getConfig().appwrite, endpoint: "https://appwrite.invalid/v1", projectId: "p", apiKey: "k" } });

/** Storage files in memory, with Appwrite's 409 on a duplicate ID. */
function stubStorage() {
  const files = new Map<string, { $id: string; name: string; $createdAt: string; sizeOriginal: number }>();
  vi.spyOn(Storage.prototype, "createFile").mockImplementation((async (p: { fileId: string; file: { filename?: string; name?: string } }) => {
    await new Promise((r) => setTimeout(r, Math.random() * 3));
    if (files.has(p.fileId)) throw new AppwriteException("exists", 409, "storage_file_already_exists");
    const f = { $id: p.fileId, name: `${p.fileId}.json`, $createdAt: new Date().toISOString(), sizeOriginal: 2 };
    files.set(p.fileId, f);
    return f;
  }) as never);
  vi.spyOn(Storage.prototype, "listFiles").mockImplementation((async (p: { queries: string[] }) => {
    await new Promise((r) => setTimeout(r, Math.random() * 3));
    const prefix = p.queries.map((q) => JSON.parse(q)).find((q) => q.method === "startsWith")?.values[0] ?? "";
    const list = [...files.values()].filter((f) => f.name.startsWith(prefix)).sort((a, b) => (a.$id < b.$id ? -1 : 1));
    return { total: list.length, files: list };
  }) as never);
  vi.spyOn(Storage.prototype, "deleteFile").mockImplementation((async (p: { fileId: string }) => { files.delete(p.fileId); return {}; }) as never);
  return files;
}

afterEach(() => vi.restoreAllMocks());

describe("Appwrite sign-in", () => {
  it("never looks the user up first, and parallel guesses cannot pass the limit", async () => {
    stubStorage();
    const lookup = vi.spyOn(Users.prototype, "list");
    const session = vi.spyOn(Account.prototype, "createEmailPasswordSession").mockRejectedValue(new AppwriteException("Invalid credentials", 401, "user_invalid_credentials"));
    const b = backend();
    const results = await Promise.all(Array.from({ length: 15 }, () => b.auth.signIn("ada@example.com", "guess", { client: "203.0.113.5" }).then(() => "ok", (e) => e.code)));
    expect(results.filter((r) => r === "unauthorized")).toHaveLength(LOGIN_LIMITS.client.max);
    expect(results.filter((r) => r === "rate_limited")).toHaveLength(15 - LOGIN_LIMITS.client.max);
    expect(session).toHaveBeenCalledTimes(LOGIN_LIMITS.client.max);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not count an Appwrite outage as a failed guess", async () => {
    const files = stubStorage();
    vi.spyOn(Account.prototype, "createEmailPasswordSession").mockRejectedValue(new AppwriteException("down", 503));
    const b = backend();
    for (let i = 0; i < 3; i++) await b.auth.signIn("bo@example.com", "pw").catch(() => undefined);
    expect(files.size).toBe(0);
  });
});

describe("Appwrite sign-up and alerts", () => {
  it("does not confirm that an address already has an account", async () => {
    vi.spyOn(Account.prototype, "create").mockRejectedValue(new AppwriteException("A user with the same id, email, or phone already exists", 409, "user_already_exists"));
    await expect(backend().auth.signUp("taken@example.com", "password123", "T")).rejects.toMatchObject({ code: "conflict", message: SIGNUP_CONFLICT });
  });

  it("reads ENGRAM_ALERT_EMAILS with the same parser as every other flag", async () => {
    const send = vi.spyOn(Messaging.prototype, "createEmail").mockResolvedValue({} as never);
    const prev = process.env.ENGRAM_ALERT_EMAILS;
    try {
      for (const [v, sent] of [["TRUE", 1], ["1", 2], ["yes", 3], ["false", 3], ["", 3]] as const) {
        process.env.ENGRAM_ALERT_EMAILS = v;
        await backend().jobs.notifyTamper({ spaceKey: "abcd1234", spaceName: "S", ownerId: "u1", message: "m" });
        expect(send).toHaveBeenCalledTimes(sent);
      }
    } finally {
      if (prev === undefined) delete process.env.ENGRAM_ALERT_EMAILS; else process.env.ENGRAM_ALERT_EMAILS = prev;
    }
  });
});

describe("Appwrite sessions", () => {
  it("only a 401 means signed out; an outage is an error", async () => {
    const get = vi.spyOn(Account.prototype, "get");
    const b = backend();
    get.mockRejectedValueOnce(new AppwriteException("No session", 401, "user_unauthorized"));
    expect(await b.auth.getUser("s")).toBeNull();
    get.mockRejectedValueOnce(new AppwriteException("Server error", 500));
    await expect(b.auth.getUser("s")).rejects.toMatchObject({ code: "unavailable" });
    get.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(b.auth.getUser("s")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("a password change ends the other sessions and keeps this one; a reset ends them all", async () => {
    vi.spyOn(Account.prototype, "updatePassword").mockResolvedValue({} as never);
    vi.spyOn(Account.prototype, "get").mockResolvedValue({ $id: "u1" } as never);
    vi.spyOn(Account.prototype, "getSession").mockResolvedValue({ $id: "s-current" } as never);
    vi.spyOn(Users.prototype, "listSessions").mockResolvedValue({ total: 3, sessions: [{ $id: "s-current" }, { $id: "s-phone" }, { $id: "s-old" }] } as never);
    const del = vi.spyOn(Users.prototype, "deleteSession").mockResolvedValue({} as never);
    const b = backend();
    await b.auth.updatePassword("secret", "old-password", "new-password");
    expect(del.mock.calls.map((c) => (c[0] as unknown as { sessionId: string }).sessionId).sort()).toEqual(["s-old", "s-phone"]);

    vi.spyOn(Account.prototype, "updateRecovery").mockResolvedValue({} as never);
    vi.spyOn(Users.prototype, "get").mockResolvedValue({ $id: "u1", email: "u1@example.com" } as never);
    stubStorage();
    const all = vi.spyOn(Users.prototype, "deleteSessions").mockResolvedValue({} as never);
    await b.auth.completeRecovery("u1", "token", "new-password-2");
    expect(all).toHaveBeenCalledWith({ userId: "u1" });
  });
});
