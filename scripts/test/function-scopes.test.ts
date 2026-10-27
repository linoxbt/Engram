/**
 * The Functions call Appwrite with a dynamic API key whose scopes are exactly the ones in appwrite.json, so a
 * missing scope is a 401 at runtime, not a deploy-time error. This table is the audit of what each Function's code
 * path reaches today; the evidence is in the comments. Keep it in step with the code: a reachable call whose scope
 * is absent is a production outage (the labeler and reflect ran for days without files.read after getSpace started
 * reading the state store), and a scope nothing reaches is privilege the dynamic key should not carry.
 */
import { readFileSync } from "node:fs";
import { ProjectKeyScopes } from "node-appwrite";
import { describe, expect, it } from "vitest";

interface FnDef { $id: string; scopes: string[]; events: string[] }
const defs: FnDef[] = JSON.parse(readFileSync("appwrite.json", "utf8")).functions;
const scopesOf = (id: string) => defs.find((f) => f.$id === id)?.scopes ?? [];

/** Every Function reads team preferences and the space state store through getSpace()/listAllSpaces(). */
const SPACE_READ = ["teams.read", "files.read"];

const REQUIRED: Record<string, string[]> = {
  // getSpace + listAllSpaces (teams.read, files.read); runCheckpoint reads the chain (vectorsdb.*.read) and writes
  // checkpoint, lock, claim and frontier files (files.write); recordIntegrity patches the state store (files.write)
  // and updateSettings writes latestCheckpoint to team prefs (teams.write); notifyTamper emails the owner
  // (messages.write). It never writes a document, so no vectorsdb write scope.
  checkpoint: [...SPACE_READ, "files.write", "messages.write", "teams.write", "vectorsdb.collections.read", "vectorsdb.documents.read", "vectorsdb.read"],
  // listAllSpaces; applyPending, sweepPendingRelate and applyRetention write documents (vectorsdb.*.write);
  // verifyAndRecord → recordIntegrity patches the state store (files.write) and may email (messages.write).
  sentinel: [...SPACE_READ, "files.write", "messages.write", "vectorsdb.collections.read", "vectorsdb.documents.read", "vectorsdb.documents.write", "vectorsdb.read", "vectorsdb.write"],
  // getSpace (teams.read, files.read); labelConcept reads the concept and its members and writes the label back.
  labeler: [...SPACE_READ, "vectorsdb.collections.read", "vectorsdb.documents.read", "vectorsdb.documents.write", "vectorsdb.read", "vectorsdb.write"],
  // listAllSpaces/getSpace (teams.read, files.read); reflect embeds the summary (embeddings.write) and appends it
  // through chain.append (vectorsdb.*.write). append touches no file and no team.
  reflect: [...SPACE_READ, "embeddings.write", "vectorsdb.collections.read", "vectorsdb.documents.read", "vectorsdb.documents.write", "vectorsdb.read", "vectorsdb.write"],
};

describe("Appwrite Function scopes", () => {
  it("declares all four Functions", () => {
    expect(defs.map((f) => f.$id).sort()).toEqual(["checkpoint", "labeler", "reflect", "sentinel"]);
  });

  for (const [id, required] of Object.entries(REQUIRED)) {
    it(`${id} has every scope its code path needs`, () => {
      expect(scopesOf(id)).toEqual(expect.arrayContaining(required));
    });
  }

  it("grants no scope Appwrite does not know", () => {
    const valid = new Set<string>(Object.values(ProjectKeyScopes));
    for (const f of defs) for (const s of f.scopes) expect(valid.has(s), `${f.$id}: unknown scope ${s}`).toBe(true);
  });

  it("gives the labeler both event namespaces, because only one of them fires here", () => {
    // docs/verified.md item 12: both databases.* and vectorsdb.* names are accepted by the API and executions did
    // fire, but no x-appwrite-event header was logged, so which namespace delivered them is still unproven.
    const events = defs.find((f) => f.$id === "labeler")!.events;
    expect(events.some((e) => e.startsWith("databases."))).toBe(true);
    expect(events.some((e) => e.startsWith("vectorsdb."))).toBe(true);
  });
});
