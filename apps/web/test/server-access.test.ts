/** What the API wrappers and route boundaries decide: viewer reads, public shapes, client IPs, demo admission. */
import { describe, expect, it } from "vitest";
import { toErrorBody, type SpaceInvite, type TeamMember } from "@engram/server";
import { assertViewerReadAllowed, VIEWER_ROLE } from "@/lib/server/access";
import { publicInvites, publicMembers } from "@/lib/server/shapes";

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

