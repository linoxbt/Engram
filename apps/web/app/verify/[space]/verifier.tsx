"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type Checkpoint, type PublicEntry, type Report } from "@engram/core";
import { ApiError, readOk } from "@/lib/client/api";
import { hasPinnedKeys, runVerification, trustedKeyFor } from "@/lib/client/verify";
import { walkProof, type ProofStep, type SigCheck } from "@/lib/client/proof";
import { criticalOf } from "@/lib/client/report-copy";
import { when } from "@/lib/format";
import { ChainStrip, type BlockState } from "@/components/chain-strip";
import { IconShield } from "@/components/icons";
import { ProofSteps, ProofVerdict } from "@/components/proof-result";
import { FindingsList, ReportVerdict } from "@/components/report-status";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { Button, Card, CopyButton, ErrorNote, Pill, Skeleton } from "@/components/ui";

interface Info { key: string; name: string; publicKey: string | null; keyId: string; latestCheckpoint: { size: number; createdAt: string } | null; sandbox: boolean }

const get = <T,>(url: string) => fetch(url).then((r) => readOk<T>(r));
const isMissing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.code === "not_found");

export function PublicVerifier({ space, proofId }: { space: string; proofId: string | null }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [entries, setEntries] = useState<PublicEntry[]>([]);
  const [cpSizes, setCpSizes] = useState<number[]>([]);
  const [states, setStates] = useState<Map<number, BlockState>>(new Map());
  const [focus, setFocus] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);
  const [running, setRunning] = useState(false);
  // Rollback memory stays on unless the visitor turns it off; the server's own "sandbox" flag is not trusted for this.
  const [rollback, setRollback] = useState(true);
  const [proof, setProof] = useState<{ steps: ProofStep[]; rootOk: boolean; sig: SigCheck; seq: number } | null>(null);

  const run = useCallback(async () => {
    setRunning(true); setError(null); setReport(null); setStates(new Map()); setProof(null);
    try {
      let i: Info;
      try { i = await get<Info>(`/api/v1/spaces/${space}`); } catch (e) { if (isMissing(e)) { setMissing(true); return; } throw e; }
      setMissing(false);
      setInfo(i);
      const { checkpoints } = await get<{ checkpoints: Checkpoint[] }>(`/api/v1/spaces/${space}/checkpoints`);
      setCpSizes(checkpoints.map((c) => Number(c.size)).filter(Number.isFinite));
      const all: PublicEntry[] = [];
      const r = await runVerification({
        space, mode: "public", publicKey: i.publicKey, checkpoints, trust: rollback,
        fetchPage: async (cursor) => {
          const p = await get<{ entries: PublicEntry[]; next: string | null }>(`/api/v1/spaces/${space}/chain?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
          all.push(...p.entries);
          setEntries([...all]);
          return p;
        },
        onProgress: (p) => {
          const m = new Map<number, BlockState>();
          for (const [s, ok] of p.results) m.set(s, ok ? "ok" : "fail");
          setStates(m);
        },
      });
      const crit = criticalOf(r).map((f) => f.seq);
      if (crit.length) {
        const first = Math.min(...crit);
        setStates((prev) => { const m = new Map(prev); for (const [s] of m) if (s >= first) m.set(s, s === first ? "fail" : "pending"); m.set(first, "fail"); return m; });
        setFocus(first);
      }
      setReport(r);
      if (proofId) {
        const p = await get<{ seq: number; leaf: string; index: number; path: string[]; checkpoint: Checkpoint }>(`/api/v1/spaces/${space}/proof/${encodeURIComponent(proofId)}`);
        const w = await walkProof({ leaf: p.leaf, index: p.index, path: p.path, checkpoint: p.checkpoint, serverKey: i.publicKey });
        setProof({ ...w, seq: p.seq });
        setFocus(p.seq);
      }
    } catch (e) { setError(e); } finally { setRunning(false); }
  }, [space, proofId, rollback]);

  useEffect(() => { void run(); }, [run]);

  if (missing) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-16">
          <Card>
            <div className="space-y-3 p-6">
              <p className="label text-gold">Public verifier</p>
              <h1 className="text-lg">Nothing to verify at <span className="tabular">{space}</span></h1>
              <p className="text-sm text-muted">This space does not exist, or its owner has not switched on public verification.</p>
              <Link href="/verify" className="inline-block text-xs text-accent hover:underline">Try another space key</Link>
            </div>
          </Card>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const blocks = entries.map((e) => ({ seq: Number(e.h.seq), op: e.h.op, hash: e.hash, text: undefined }));
  const tone = report ? (report.status === "valid" ? "valid" : report.status === "warning" ? "warning" : "tampered") : undefined;
  const trust = info ? trustedKeyFor(info.keyId, info.publicKey) : null;
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="label text-gold">Public verifier</p>
            <h1 className="mt-1 break-words text-lg">{info?.name ?? space} <span className="text-xs text-muted tabular">{space}</span> {info?.sandbox && <Pill tone="warning">sandbox</Pill>}</h1>
          </div>
          <Button variant="gold" onClick={run} loading={running}><IconShield /> Verify again</Button>
        </div>

        <ErrorNote error={error} />

        <Card state={tone}>
          <div className="p-5">
            {!report && running && <div className="flex items-center gap-2 text-sm text-muted"><Skeleton className="size-4" /> Recomputing {entries.length} hashes in your browser…</div>}
            {report && (
              <div>
                <ReportVerdict report={report} size={24} className="text-lg" />
                <p className="mt-1 text-xs text-muted">{report.entries} entries · {report.checkpointsValid}/{report.checkpointsTotal} signed checkpoints valid{report.latestCheckpoint ? ` · latest signed ${when(report.latestCheckpoint.createdAt)}` : ""}</p>
              </div>
            )}
          </div>
          {blocks.length > 0 && <div className="px-5 pb-5"><ChainStrip blocks={blocks} checkpoints={cpSizes} states={states} focusSeq={focus} label="Verified chain" /></div>}
          {report && <FindingsList findings={report.findings} onSeq={setFocus} />}
          <label className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5 text-2xs text-muted">
            <input type="checkbox" checked={rollback} onChange={(e) => setRollback(e.target.checked)} className="size-3.5 accent-[#0a0a0a]" />
            Rollback memory: flag the chain if it no longer covers the newest checkpoint this browser has seen.
            {info?.sandbox && <span className="basis-full">This space says it is a sandbox, whose history is reset on purpose. Turn rollback memory off if a reset is expected.</span>}
          </label>
        </Card>

        {proof && (
          <Card title={`Inclusion proof for #${proof.seq}`} state={proof.rootOk && proof.sig.ok !== false ? (proof.sig.ok && proof.sig.pinned && !proof.sig.mismatch ? "sealed" : "warning") : "tampered"}>
            <div className="space-y-3 p-4">
              <ProofSteps steps={proof.steps} rootOk={proof.rootOk} />
              <ProofVerdict rootOk={proof.rootOk} sig={proof.sig} />
            </div>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="How this works">
            <p className="prose-sans p-4 text-sm text-muted">
              This page never sees memory text and does not trust the server. It downloads only each entry&apos;s header (sequence number, previous hash, salted content hash, vector hash, author and time) and the signed checkpoints.
              It recomputes every entry hash, checks every link to the previous entry, rebuilds the Merkle root for each checkpoint and verifies its Ed25519 signature with the public key built into this site.
              Any edit, deletion or reordering after a memory was written shows up here.
            </p>
          </Card>
          <Card title="Public key" state={trust && trust.pinned && !trust.mismatch ? "sealed" : "warning"}>
            <div className="space-y-2 p-4 text-xs">
              {trust?.key ? <div className="flex items-start gap-1"><code className="min-w-0 break-all text-gold">{trust.key}</code><CopyButton value={trust.key} /></div> : null}
              {info && !hasPinnedKeys && <p className="text-warn">This site was built without a public key, so it can only use the key the server offers. Signatures are not independently checked.</p>}
              {info && hasPinnedKeys && !trust?.key && <p className="text-warn">No built-in key matches key ID {info.keyId}.</p>}
              {trust?.mismatch && <p className="text-warn">The server offered a different key from the one built into this site. The built-in key is used.</p>}
              <p className="text-muted">Key ID {info?.keyId ?? "…"}. Compare it with the key published in the project README.</p>
            </div>
          </Card>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
