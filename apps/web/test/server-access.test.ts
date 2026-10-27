/** What the API wrappers and route boundaries decide: viewer reads, public shapes, client IPs, demo admission. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalBackend, setConfig, toErrorBody, type Backend, type SpaceInvite, type TeamMember } from "@engram/server";
import { assertViewerReadAllowed, originAllowed, VIEWER_ROLE } from "@/lib/server/access";
import { clientIpFrom } from "@/lib/server/limits";
import { publicInvites, publicMembers } from "@/lib/server/shapes";
import { admitGuest, GUEST_ENTER_LIMIT, MAX_LIVE_GUESTS, sweepGuestSlots } from "@/lib/server/guest-slots";

const SP = "/api/app/spaces/abcd1234";
const viewer = { viewer: true };
const member = { viewer: false };
const person = { guest: false };
const guest = { guest: true };
const refusal = (fn: () => void) => { try { fn(); return null; } catch (e) { return toErrorBody(e); } };

describe("what a read-only viewer may read", () => {
  it("allows exactly the routes the read-only demo needs", () => {
    const allowed: [string, string][] = [
      ["GET", SP], ["GET", `${SP}/overview`], ["GET", `${SP}/feed`], ["GET", `${SP}/memories`],
      ["GET", `${SP}/memories/m_abcd1234_000000000001`], ["GET", `${SP}/memories/m_abcd1234_000000000001/proof`],
      ["POST", `${SP}/memories/m_abcd1234_000000000001/proof`],
      ["GET", `${SP}/chain`], ["HEAD", `${SP}/chain`], ["GET", `${SP}/checkpoints`], ["GET", `${SP}/concepts`],
      ["GET", `${SP}/concepts/c1`], ["GET", `${SP}/conflicts`], ["GET", `${SP}/subjects`], ["GET", `${SP}/timeline`],
      ["GET", `${SP}/gaps`], ["POST", `${SP}/recall`], ["POST", `${SP}/verify`],
    ];
    for (const [m, r] of allowed) expect(() => assertViewerReadAllowed(person, viewer, m, r), `${m} ${r}`).not.toThrow();
  });

  it("refuses the reads that would hand out text, salts, addresses or the key registry", () => {
    // /export is the headline one: it carries every memory's text AND its content salt.
    for (const r of ["/export", "/recalls", "/agents", "/agents/find", "/agents/a1", "/members", "/members/u1", "/lab"]) {
      expect(refusal(() => assertViewerReadAllowed(person, viewer, "GET", SP + r)), r).toMatchObject({ status: 403, body: { error: { code: "read_only" } } });
    }
    // A route nobody listed is refused rather than quietly allowed.
    expect(refusal(() => assertViewerReadAllowed(person, viewer, "GET", `${SP}/something-new`))).toMatchObject({ status: 403 });
    // And a guest who somehow held a full role is treated the same.
    expect(refusal(() => assertViewerReadAllowed(guest, member, "GET", `${SP}/export`))).toMatchObject({ status: 403 });
  });

  it("leaves members and owners alone, and says nothing about routes outside a space", () => {
    for (const r of ["/export", "/recalls", "/agents", "/members"]) {
      expect(() => assertViewerReadAllowed(person, member, "GET", SP + r), r).not.toThrow();
    }
    for (const r of ["/api/app/spaces", "/api/auth/me", "/api/v1/health"]) {
      expect(() => assertViewerReadAllowed(person, viewer, "GET", r), r).not.toThrow();
    }
    expect(VIEWER_ROLE).toBe("viewer");
  });
});

describe("same-origin check", () => {
  it("accepts our own host and the configured app URL, and nothing a caller can name itself", () => {
    const own = ["engram.example", "engram.netlify.app"];
    expect(originAllowed("https://engram.example", own)).toBe(true);
    expect(originAllowed(null, own)).toBe(true);
    expect(originAllowed("null", own)).toBe(true);
    expect(originAllowed("https://evil.com", own)).toBe(false);
    expect(originAllowed("not a url", own)).toBe(false);
    expect(originAllowed("https://engram.example.evil.com", own)).toBe(false);
  });
});

describe("the address a request is limited by", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("in production trusts only the platform header, never anything the caller can set", () => {
    expect(clientIpFrom(h({ "x-nf-client-connection-ip": "203.0.113.9" }), true)).toBe("203.0.113.9");
    // A spoofed address per request would otherwise void every IP-keyed limit at once.
    expect(clientIpFrom(h({ "x-real-ip": "1.2.3.4" }), true)).toBe("unknown");
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4" }), true)).toBe("unknown");
    expect(clientIpFrom(h({ "x-real-ip": "1.2.3.4", "x-nf-client-connection-ip": "203.0.113.9" }), true)).toBe("203.0.113.9");
    expect(clientIpFrom(h({}), true)).toBe("unknown");
  });

  it("still falls back for a proxy in front of a dev server", () => {
    expect(clientIpFrom(h({ "x-real-ip": "1.2.3.4" }), false)).toBe("1.2.3.4");
    expect(clientIpFrom(h({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" }), false)).toBe("1.2.3.4");
    expect(clientIpFrom(h({ "x-nf-client-connection-ip": "203.0.113.9", "x-real-ip": "1.2.3.4" }), false)).toBe("203.0.113.9");
  });
});

describe("what other people's records look like over the wire", () => {
  const members: (TeamMember & { owner: boolean })[] = [
    { userId: "u1", name: "Ada", email: "ada@example.com", roles: ["owner"], joinedAt: "2026-01-01T00:00:00.000Z", owner: true },
    { userId: "u2", name: "Gil", email: "gil@example.com", roles: ["member"], joinedAt: "2026-01-02T00:00:00.000Z", owner: false },
  ];

  it("hides addresses and account IDs from everyone but the owner", () => {
    expect(publicMembers(members, true)).toEqual(members);
    const seen = publicMembers(members, false);
    expect(seen.map((m) => m.name)).toEqual(["Ada", "Gil"]);
    for (const m of seen) {
      expect(m).not.toHaveProperty("email");
      expect(m).not.toHaveProperty("userId");
      expect(m.roles).toBeDefined();
    }
  });

  it("never lets an invite's token hash or inviter out, even to the owner", () => {
    const invites: SpaceInvite[] = [{
      id: "i1", tokenHash: "deadbeef", email: "new@example.com", createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z", createdBy: "u1",
    }];
    expect(publicInvites(invites)).toEqual([{ id: "i1", email: "new@example.com", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-08T00:00:00.000Z" }]);
    expect(publicInvites(undefined)).toEqual([]);
  });
});

describe("demo guest admission", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "engram-guest-"));
  const backend = (d: string): Backend => {
    setConfig({ backend: "local", classifierModel: null });
    return createLocalBackend({ dir: d });
  };
  const marker = (b: Backend, n: number) => b.files.put("checkpoints", `gu_x${n}`, `gu_x${n}.json`, new TextEncoder().encode("{}"), []);

  it("counts one network's visits across every server instance, not per process", async () => {
    const d = dir();
    const b = backend(d);
    const t = Date.UTC(2026, 9, 27, 12, 0, 0);
    for (let i = 0; i < GUEST_ENTER_LIMIT.max; i++) await admitGuest(b, "203.0.113.9", t);
    // A second instance, with its own memory, reads the same reserved slots: the quota is not per process.
    const other = backend(d);
    expect(toErrorBody(await admitGuest(other, "203.0.113.9", t).catch((e) => e))).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    // Another network is unaffected, and so is the next hour.
    await expect(admitGuest(other, "198.51.100.4", t)).resolves.toBeUndefined();
    await expect(admitGuest(other, "203.0.113.9", t + GUEST_ENTER_LIMIT.windowMs)).resolves.toBeUndefined();
  });

  it("refuses everyone once the demo already holds as many live guests as it will", async () => {
    const b = backend(dir());
    for (let i = 0; i < MAX_LIVE_GUESTS - 1; i++) await marker(b, i);
    await expect(admitGuest(b, "203.0.113.9")).resolves.toBeUndefined();
    await marker(b, MAX_LIVE_GUESTS);
    expect(toErrorBody(await admitGuest(b, "198.51.100.4").catch((e) => e))).toMatchObject({ status: 429, body: { error: { message: expect.stringMatching(/full/) } } });
  });

  it("sweeps reservations whose hour has passed, and keeps the live ones", async () => {
    const b = backend(dir());
    const t = Date.UTC(2026, 9, 27, 12, 0, 0);
    await admitGuest(b, "203.0.113.9", t);
    expect(await sweepGuestSlots(b, Date.now())).toBe(0);
    expect(await sweepGuestSlots(b, Date.now() + 2 * GUEST_ENTER_LIMIT.windowMs)).toBe(1);
    // Swept, so the window starts clean rather than leaving a file behind for good.
    await expect(admitGuest(b, "203.0.113.9", t)).resolves.toBeUndefined();
  });
});
