/**
 * Decrypt a provisioning report written by scripts/provision.ts.
 *
 *   pnpm decrypt-report --keygen ~/.engram/report.key       # once: writes the private key, prints ENGRAM_REPORT_PUBKEY
 *   pnpm decrypt-report ~/.engram/report.key <file.enc.json | https://site/_provision/<run>.enc.json> [--out report.json]
 *
 * The private key never leaves your machine; only the public key goes into the hosting environment.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decryptReport, generateReportKeyPair, parsePrivateKey, type ReportEnvelope } from "./lib/report-crypto";

const args = process.argv.slice(2);
const usage = "Usage:\n  tsx scripts/decrypt-report.ts --keygen <private-key-file>\n  tsx scripts/decrypt-report.ts <private-key-file> <report.enc.json | URL> [--out <file>]";

if (args[0] === "--keygen") {
  const path = args[1];
  if (!path) { console.error(usage); process.exit(1); }
  if (existsSync(path)) { console.error(`${path} already exists; refusing to overwrite a private key.`); process.exit(1); }
  const kp = generateReportKeyPair();
  writeFileSync(path, kp.privateKeyPem, { mode: 0o600 });
  console.log(`Private key written to ${path} (keep it off the server).\nSet this in the hosting environment:\n\nENGRAM_REPORT_PUBKEY=${kp.publicKey}`);
  process.exit(0);
}

const [keyPath, source] = args;
if (!keyPath || !source) { console.error(usage); process.exit(1); }
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : undefined;

const text = /^https?:\/\//.test(source)
  ? await fetch(source, { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error(`${source}: HTTP ${r.status}`); return r.text(); })
  : readFileSync(source, "utf8");
const envelope = JSON.parse(text) as ReportEnvelope;
const plain = decryptReport(envelope, parsePrivateKey(readFileSync(keyPath, "utf8")));
const pretty = JSON.stringify(JSON.parse(plain), null, 2);
if (out) { writeFileSync(out, pretty, { mode: 0o600 }); console.log(`Decrypted report written to ${out}`); }
else console.log(pretty);
