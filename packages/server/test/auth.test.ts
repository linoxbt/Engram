/** Account recovery, verification and profile changes on the local backend. */
import { describe, expect, it, vi } from "vitest";
import { createLocalBackend } from "../src/index";

const linkParams = (link: string) => { const u = new URL(link); return { userId: u.searchParams.get("userId")!, secret: u.searchParams.get("secret")! }; };

describe("local auth", () => {
  it("resets a password with a one-time link and signs out other sessions", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("ada@example.com", "password123", "Ada");
    const old = await b.auth.signIn("ada@example.com", "password123");
    const { devLink } = await b.auth.requestRecovery("ada@example.com", "https://app.example/reset-password");
    const { userId, secret } = linkParams(devLink!);
    await b.auth.completeRecovery(userId, secret, "brand-new-pass");
    expect(await b.auth.getUser(old.secret)).toBeNull();
    await expect(b.auth.signIn("ada@example.com", "password123")).rejects.toThrow(/Invalid email or password/);
    await expect(b.auth.signIn("ada@example.com", "brand-new-pass")).resolves.toBeTruthy();
    await expect(b.auth.completeRecovery(userId, secret, "another-pass")).rejects.toThrow(/invalid or has expired/);
  });

  it("does not reveal whether an address has an account", async () => {
    const b = createLocalBackend();
    await expect(b.auth.requestRecovery("nobody@example.com", "https://app.example/reset-password")).resolves.toEqual({});
  });

  it("verifies an email address once", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("bo@example.com", "password123", "Bo");
    const s = await b.auth.signIn("bo@example.com", "password123");
    expect((await b.auth.getUser(s.secret))?.emailVerified).toBe(false);
    const { userId, secret } = linkParams((await b.auth.requestVerification(s.secret, "https://app.example/verify-email")).devLink!);
    await b.auth.completeVerification(userId, secret, s.secret);
    expect((await b.auth.getUser(s.secret))?.emailVerified).toBe(true);
    await expect(b.auth.completeVerification(userId, secret, s.secret)).rejects.toThrow(/invalid or has expired/);
  });

  it("changes name and password, checks the current password, and deletes the account", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("cy@example.com", "password123", "Cy");
    const s = await b.auth.signIn("cy@example.com", "password123");
    expect((await b.auth.updateName(s.secret, "Cyrus")).name).toBe("Cyrus");
    await expect(b.auth.updatePassword(s.secret, "wrong-password", "password456")).rejects.toThrow(/current password is incorrect/);
    await b.auth.updatePassword(s.secret, "password123", "password456");
    await expect(b.auth.signIn("cy@example.com", "password456")).resolves.toBeTruthy();
    const user = (await b.auth.getUser(s.secret))!;
    await b.auth.deleteUser(user.id);
    expect(await b.auth.getUser(s.secret)).toBeNull();
    expect(await b.auth.findUserByEmail("cy@example.com")).toBeNull();
  });

  it("passkey changes need a recent sign-in, and passkey options name this site", async () => {
    const b = createLocalBackend();
    await b.auth.signUp("dee@example.com", "password123", "Dee");
    const s = await b.auth.signIn("dee@example.com", "password123");
    const c = await b.auth.startPasskeyRegistration(s.secret, "Laptop", "https://engram.example");
    expect(c.publicKey).toMatchObject({ rp: { id: "engram.example", name: "Engram" }, authenticatorSelection: { residentKey: "required", userVerification: "required" } });
    const signIn = await b.auth.startPasskeySignIn("https://engram.example");
    expect(signIn.publicKey).toMatchObject({ rpId: "engram.example", userVerification: "required" });
    // A forged or replayed sign-in never yields a session, and each challenge works once.
    await expect(b.auth.finishPasskeySignIn(signIn.id, { id: "nope", type: "public-key", response: {} }, "https://engram.example")).rejects.toThrow(/could not be verified/);
    await expect(b.auth.finishPasskeySignIn(signIn.id, { id: "nope", type: "public-key", response: {} }, "https://engram.example")).rejects.toThrow(/expired/);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await expect(b.auth.startPasskeyRegistration(s.secret, "Phone", "https://engram.example")).rejects.toMatchObject({ code: "reauth_required" });
    expect(await b.auth.listPasskeys(s.secret)).toEqual([]);
    vi.useRealTimers();
  });
});
