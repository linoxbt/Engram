"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type Checkpoint, type PublicEntry, type Report } from "@engram/core";
import { runVerification } from "@/lib/client/verify";
import { walkProof, type ProofStep } from "@/lib/client/proof";
import { shortHash, when } from "@/lib/format";
import { ChainStrip, type BlockState } from "@/components/chain-strip";
import { IconAlert, IconCross, IconSeal, IconShield, IconTick } from "@/components/icons";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { Button, Card, CopyButton, ErrorNote, Pill, Skeleton, cx } from "@/components/ui";

interface Info { key: string; name: string; publicKey: string | null; keyId: string; latestCheckpoint: { size: number; createdAt: string } | null; sandbox: boolean }

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export function PublicVerifier({ space }: { space: string }) {
  const params = useSearchParams();
  const proofId = params.get("proof");
  const [info, setInfo] = useState<Info | null>(null);
  const [entries, setEntries] = useState<PublicEntry[]>([]);
  const [states, setStates] = useState<Map<number, BlockState>>(new Map());
  const [focus, setFocus] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [proof, setProof] = useState<{ steps: ProofStep[]; rootOk: boolean; sigOk: boolean | null; seq: number } | null>(null);

  const run = useCallback(async () => {
    setRunning(true); setError(null); setReport(null); setStates(new Map());
    try {
      const i = await get<Info>(`/api/v1/spaces/${space}`);
      setInfo(i);
      const { checkpoints } = await get<{ checkpoints: Checkpoint[] }>(`/api/v1/spaces/${space}/checkpoints`);
      const all: PublicEntry[] = [];
      const r = await runVerification({
        space, mode: "public", publicKey: i.publicKey, checkpoints,
        fetchPage: async (cursor) => {
          const p = await get<{ entries: PublicEntry[]; next: string | null }>(`/api/v1/spaces/${space}/chain?limit=500${cursor ? `&cursor=${cursor}` : ""}`);
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
      const crit = r.findings.filter((f) => f.severity === "critical").map((f) => f.seq);
      if (crit.length) {
        const first = Math.min(...crit);
        setStates((prev) => { const m = new Map(prev); for (const [s] of m) if (s >= first) m.set(s, s === first ? "fail" : "pending"); m.set(first, "fail"); return m; });
        setFocus(first);
      }
      setReport(r);
      if (proofId) {
        const p = await get<{ seq: number; leaf: string; index: number; path: string[]; checkpoint: Checkpoint }>(`/api/v1/spaces/${space}/proof/${encodeURIComponent(proofId)}`);
        const w = await walkProof({ leaf: p.leaf, index: p.index, size: Number(p.checkpoint.size), path: p.path, checkpoint: p.checkpoint, publicKey: i.publicKey });
        setProof({ ...w, seq: p.seq });
        setFocus(p.seq);
      }
    } catch (e) { setError(e); } finally { setRunning(false); }
  }, [space, proofId]);

  useEffect(() => { void run(); }, [run]);

  const crit = report?.findings.filter((f) => f.severity === "critical") ?? [];
  const blocks = entries.map((e) => ({ seq: Number(e.h.seq), op: e.h.op, hash: e.hash, text: null }));
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label text-gold">Public verifier</p>
            <h1 className="mt-1 text-lg">{info?.name ?? space} <span className="text-xs text-muted tabular">{space}</span> {info?.sandbox && <Pill tone="warning">sandbox</Pill>}</h1>
          </div>
          <Button variant="gold" onClick={run} loading={running}><IconShield /> Verify again</Button>
        </div>

        <ErrorNote error={error} />

        <Card state={report ? (report.status === "tampered" ? "tampered" : "valid") : undefined}>
          <div className="p-5">
            {!report && running && <div className="flex items-center gap-2 text-sm text-muted"><Skeleton className="size-4" /> Recomputing {entries.length} hashes in your browser…</div>}
            {report && (
              <div className={cx("flex items-start gap-3", report.status === "tampered" ? "text-tamper" : "text-valid")}>
                {report.status === "tampered" ? <IconAlert size={24} /> : <IconTick size={24} />}
                <div>
                  <div className="text-lg">{report.status === "tampered" ? (crit[0]?.rule === "truncation" ? crit[0].message : `Memory #${crit[0]?.seq} was changed after it was written.`) : `Verified through #${report.validThrough}.`}</div>
                  <p className="mt-1 text-xs text-muted">{report.entries} entries · {report.checkpointsValid}/{report.checkpointsTotal} signed checkpoints valid{report.latestCheckpoint ? ` · latest signed ${when(report.latestCheckpoint.createdAt)}` : ""}</p>
                </div>
              </div>
            )}
          </div>
          {blocks.length > 0 && <div className="px-5 pb-5"><ChainStrip blocks={blocks} states={states} focusSeq={focus} label="Verified chain" /></div>}
          {crit.length > 0 && (
            <ul className="border-t border-line text-xs">
              {crit.slice(0, 8).map((f, i) => <li key={i} className="flex gap-3 border-b border-line px-5 py-2"><span className="tabular text-tamper">#{f.seq}</span><span className="text-muted">{f.rule}</span><span>{f.message}</span></li>)}
            </ul>
          )}
        </Card>

        {proof && (
          <Card title={`Inclusion proof for #${proof.seq}`} state={proof.rootOk && proof.sigOk !== false ? "sealed" : "tampered"}>
            <ol className="space-y-1 p-4">
              {proof.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-2xs"><IconTick size={11} className="text-valid" /><span className="w-16 text-muted">{s.label}</span><span className="ml-auto tabular">{shortHash(s.hash)}</span></li>
              ))}
            </ol>
            <p className={cx("border-t border-line px-4 py-2.5 text-xs", proof.rootOk ? "text-gold" : "text-tamper")}>
              {proof.rootOk ? <IconSeal className="mr-1 inline" /> : <IconCross className="mr-1 inline" />}
              {proof.rootOk ? "This memory is part of the signed checkpoint." : "The proof does not reach the checkpoint root."} {proof.sigOk == null ? "" : proof.sigOk ? "Signature valid." : "Signature invalid."}
            </p>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="How this works">
            <p className="prose-sans p-4 text-sm text-muted">
              This page never sees memory text and does not trust the server. It downloads only each entry's header (sequence number, previous hash, salted content hash, vector hash, author and time) and the signed checkpoints.
              It recomputes every entry hash, checks every link to the previous entry, rebuilds the Merkle root for each checkpoint and verifies its Ed25519 signature with the public key below.
              Any edit, deletion or reordering after a memory was written shows up here.
            </p>
          </Card>
          <Card title="Public key" state="sealed">
            <div className="space-y-2 p-4 text-xs">
              {info?.publicKey ? <div className="flex items-start gap-1"><code className="break-all text-gold">{info.publicKey}</code><CopyButton value={info.publicKey} /></div> : <p className="text-warn">This deployment has no public key configured, so signatures cannot be checked.</p>}
              <p className="text-muted">Key ID {info?.keyId ?? "…"}. Compare it with the key published in the project README.</p>
            </div>
          </Card>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
