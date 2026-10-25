import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeRedactor, redactDeep, secretNames } from "../lib/redact";
import { decryptReport, encryptReport, generateReportKeyPair, parsePrivateKey, parsePublicKey } from "../lib/report-crypto";
import { parseSections, renderSections, upsertSection } from "../lib/verified-md";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

describe("report encryption", () => {
  it("round-trips through the X25519 + AES-256-GCM envelope", () => {
    const kp = generateReportKeyPair();
    const report = JSON.stringify({ run: "abc", steps: [{ name: "setup", ok: true, output: "✓ created database" }] });
    const env = encryptReport(report, parsePublicKey(kp.publicKey));
    expect(env.alg).toBe("X25519-HKDF-SHA256-AES-256-GCM");
    expect(JSON.stringify(env)).not.toContain("created database");
    expect(decryptReport(env, parsePrivateKey(kp.privateKeyPem))).toBe(report);
  });

  it("accepts hex public keys and raw private keys, and rejects the wrong key or a tampered ciphertext", () => {
    const kp = generateReportKeyPair();
    const hex = Buffer.from(kp.publicKey, "base64").toString("hex");
    const env = encryptReport("secret report", parsePublicKey(hex));
    const rawPriv = (parsePrivateKey(kp.privateKeyPem).export({ format: "jwk" }) as { d: string }).d;
    expect(decryptReport(env, parsePrivateKey(Buffer.from(rawPriv, "base64url").toString("base64")))).toBe("secret report");

    const other = generateReportKeyPair();
    expect(() => decryptReport(env, parsePrivateKey(other.privateKeyPem))).toThrow();
    const ct = Buffer.from(env.ct, "base64");
    ct[0] ^= 1;
    expect(() => decryptReport({ ...env, ct: ct.toString("base64") }, parsePrivateKey(kp.privateKeyPem))).toThrow();
    expect(() => parsePublicKey("dG9vIHNob3J0")).toThrow(/32-byte/);
  });

  it("decrypt-report decrypts a file written by encryptReport", () => {
    const dir = mkdtempSync(join(tmpdir(), "engram-report-"));
    const kp = generateReportKeyPair();
    writeFileSync(join(dir, "k.pem"), kp.privateKeyPem);
    writeFileSync(join(dir, "r.enc.json"), JSON.stringify(encryptReport(JSON.stringify({ run: "zz", ok: true }), parsePublicKey(kp.publicKey))));
    const r = spawnSync(process.execPath, ["--import", tsx, join(root, "scripts/decrypt-report.ts"), join(dir, "k.pem"), join(dir, "r.enc.json")], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ run: "zz", ok: true });
  });
});

describe("redaction", () => {
  const env = {
    APPWRITE_API_KEY: "standard_" + "a1".repeat(40), OPENAI_API_KEY: "sk-proj-abcdefghijklmnop1234", ANTHROPIC_API_KEY: "sk-ant-api03-zzzzzzzzzzzzzzzz",
    ERROR_WEBHOOK_URL: "https://example.com/hook/very-secret-path", CUSTOM_TOKEN: "tok_123456789", NEXT_PUBLIC_CP_PUBLIC_KEY: "ec0a9a63949ad6b798f2f85d802d33d1",
  };
  const redact = makeRedactor(env);

  it("removes every secret env value and keeps public keys", () => {
    const text = Object.values(env).join(" ");
    const out = redact(text);
    for (const k of ["APPWRITE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ERROR_WEBHOOK_URL", "CUSTOM_TOKEN"]) {
      expect(out).not.toContain(env[k as keyof typeof env]);
      expect(out).toContain(`<${k}>`);
    }
    expect(out).toContain(env.NEXT_PUBLIC_CP_PUBLIC_KEY);
    expect(secretNames(env)).not.toContain("NEXT_PUBLIC_CP_PUBLIC_KEY");
  });

  it("catches credentials that are not in the environment", () => {
    const r = makeRedactor({});
    const samples = [
      "eng_ab12_" + "x".repeat(32), "standard_" + "f".repeat(64), "sk-ant-api03-" + "q".repeat(20), "sk-" + "w".repeat(30),
      "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4eXoifQ.c2lnbmF0dXJlc2lnbmF0dXJl", "ghp_" + "g".repeat(36),
      "https://hooks.slack.com/services/T000/B000/XXXX", "https://discord.com/api/webhooks/123/abc",
    ];
    for (const s of samples) expect(r(`value: ${s} end`)).not.toContain(s);
    expect(r("GET https://x.io/a?token=abc123&page=2")).toBe("GET https://x.io/a?token=<redacted>&page=2");
    expect(r("https://bob:hunter2@db.example.com/x")).toBe("https://<credentials>@db.example.com/x");
    expect(r('{"secret":"s3cr3t","name":"ok"}')).toBe('{"secret":"<redacted>","name":"ok"}');
    expect(r("X-Appwrite-Key: standard_abc")).not.toContain("standard_abc");
  });

  it("redacts nested report values without breaking JSON escaping", () => {
    const quoted = makeRedactor({ SEED_ADMIN_TOKEN: 'ab"cd\\ef12' });
    const out = redactDeep({ a: [{ b: 'token ab"cd\\ef12 here' }], n: 3 }, quoted);
    expect(out).toEqual({ a: [{ b: "token <SEED_ADMIN_TOKEN> here" }], n: 3 });
  });
});

describe("provision gating", () => {
  const runProvision = (env: Record<string, string>, args: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), "engram-prov-"));
    mkdirSync(join(dir, "apps/web/public/_provision"), { recursive: true });
    writeFileSync(join(dir, "apps/web/public/_provision/oldrun.json"), "{\"stale\":true}");
    writeFileSync(join(dir, "apps/web/public/_provision/keep.enc.json"), "{}");
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ENGRAM_|CONTEXT$|NETLIFY$|APPWRITE_)/.test(k)));
    const r = spawnSync(process.execPath, ["--import", tsx, join(root, "scripts/provision.ts"), ...args], {
      cwd: dir, encoding: "utf8", timeout: 60_000, env: { ...clean, TSX_TSCONFIG_PATH: join(root, "tsconfig.json"), ...env } as NodeJS.ProcessEnv,
    });
    return { ...r, dir };
  };

  it("skips deploy previews and branch deploys, and says why", () => {
    for (const context of ["deploy-preview", "branch-deploy"]) {
      const r = runProvision({ ENGRAM_PROVISION: "abcdefghij0123456789", CONTEXT: context, NETLIFY: "true" }, ["--local"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`skipped: Netlify CONTEXT is "${context}"`);
    }
  });

  it("logs a malformed run id instead of exiting silently", () => {
    const r = runProvision({ ENGRAM_PROVISION: "Short-ID", CONTEXT: "production" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ENGRAM_PROVISION is set but malformed/);
  });

  it("removes plaintext reports from older builds and keeps encrypted ones", () => {
    const r = runProvision({});
    expect(r.status).toBe(0);
    expect(existsSync(join(r.dir, "apps/web/public/_provision/oldrun.json"))).toBe(false);
    expect(readFileSync(join(r.dir, "apps/web/public/_provision/keep.enc.json"), "utf8")).toBe("{}");
  });
});

describe("verified.md sections", () => {
  it("replaces one section and keeps the others, migrating a legacy file into core", () => {
    const dir = mkdtempSync(join(tmpdir(), "engram-ver-"));
    const path = join(dir, "verified.md");
    writeFileSync(path, "# Day 1 verification results\n\n| # | Item |\n|---|---|\n| 1 | a |\n");
    upsertSection("quality", "## Quality\n\n22/30", path);
    let s = parseSections(readFileSync(path, "utf8"));
    expect(s.get("core")).toContain("| 1 | a |");
    expect(s.get("quality")).toContain("22/30");
    upsertSection("core", "## Core\n\nnew", path);
    s = parseSections(readFileSync(path, "utf8"));
    expect(s.get("core")).toBe("## Core\n\nnew");
    expect(s.get("quality")).toContain("22/30");
    expect(renderSections(s).indexOf("section core")).toBeLessThan(renderSections(s).indexOf("section quality"));
  });
});
