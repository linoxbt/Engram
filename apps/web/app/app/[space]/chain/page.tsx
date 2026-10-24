"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { verifyCheckpointSig, type ChainEntry, type Checkpoint, type Report } from "@engram/core";
import { api } from "@/lib/client/api";
import { useSpaceInfo } from "@/lib/client/hooks";
import { runVerification } from "@/lib/client/verify";
import { shortHash, when } from "@/lib/format";
import { ChainStrip, type BlockState } from "@/components/chain-strip";
import { IconAlert, IconCross, IconExternal, IconSeal, IconShield, IconTick } from "@/components/icons";
import { PageHeader, useOpenMemory } from "@/components/space-shell";
import { Button, Card, CopyButton, ErrorNote, Pill, Skeleton, cx, useToast } from "@/components/ui";

type Page = { entries: ChainEntry[]; next: string | null };

async function fetchAll(space: string, vectors: boolean): Promise<ChainEntry[]> {
  const out: ChainEntry[] = [];
  let cursor: string | null = null;
  for (;;) {
    const p: Page = await api<Page>(`/api/app/spaces/${space}/chain?limit=500${vectors ? "&vectors=1" : ""}${cursor ? `&cursor=${cursor}` : ""}`);
    out.push(...p.entries);
    if (!p.next) return out;
    cursor = p.next;
  }
}

export default function ChainPage() {
  const { space } = useParams<{ space: string }>();
  const open = useOpenMemory();
  const qc = useQueryClient();
  const toast = useToast();
  const info = useSpaceInfo(space);
  const chain = useQuery({ queryKey: ["space", space, "chain-all"], queryFn: () => fetchAll(space, false) });
  const cps = useQuery({ queryKey: ["space", space, "checkpoints"], queryFn: () => api<{ checkpoints: Checkpoint[] }>(`/api/app/spaces/${space}/checkpoints`) });
  const [mode, setMode] = useState<"standard" | "deep">("standard");
  const [states, setStates] = useState<Map<number, BlockState>>(new Map());
  const [focus, setFocus] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sigs, setSigs] = useState<Map<string, boolean>>(new Map());
  const cancel = useRef(false);

  const pub = info.data?.publicKey ?? null;
  useEffect(() => {
    if (!cps.data || !pub) return;
    void (async () => {
      const m = new Map<string, boolean>();
      for (const c of cps.data.checkpoints) m.set(c.seq, await verifyCheckpointSig(c, pub));
      setSigs(m);
    })();
  }, [cps.data, pub]);

  const blocks = useMemo(() => (chain.data ?? []).map((e) => ({ seq: Number(e.metadata.seq), op: e.metadata.op, status: e.metadata.d?.status, hash: e.metadata.hash, text: e.metadata.c?.text })), [chain.data]);
  const cpSizes = useMemo(() => (cps.data?.checkpoints ?? []).map((c) => Number(c.size)), [cps.data]);

  const recordServer = useMutation({ mutationFn: () => api(`/api/app/spaces/${space}/verify?mode=${mode}`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["space", space, "info"] }) });
  const seal = useMutation({
    mutationFn: () => api<{ created: boolean; reason?: string }>(`/api/app/spaces/${space}/checkpoints`, { method: "POST" }),
    onSuccess: (r) => { toast(r.created ? "Checkpoint signed." : `No checkpoint: ${r.reason}`, r.created ? "ok" : "info"); qc.invalidateQueries({ queryKey: ["space", space] }); },
  });

  const verify = async () => {
    setRunning(true); setError(null); setReport(null); setStates(new Map()); setFocus(null); cancel.current = false;
    try {
      const entries = mode === "deep" ? await fetchAll(space, true) : await fetchAll(space, false);
      const checkpoints = (await api<{ checkpoints: Checkpoint[] }>(`/api/app/spaces/${space}/checkpoints`)).checkpoints;
      let results = new Map<number, boolean>();
      const pages: Page[] = [];
      for (let i = 0; i < entries.length; i += 500) pages.push({ entries: entries.slice(i, i + 500), next: i + 500 < entries.length ? String(i + 500) : null });
      let pi = 0;
      const r = await runVerification({
        space, mode, publicKey: pub, checkpoints,
        fetchPage: async () => pages[pi++] ?? { entries: [], next: null },
        onProgress: (p) => { results = p.results; },
      });
      // Animate: blocks tick green left to right, about 15 ms apart, capped at 3 seconds.
      const seqs = [...results.keys()].sort((a, b) => a - b);
      const firstCrit = r.findings.filter((f) => f.severity === "critical").map((f) => f.seq).sort((a, b) => a - b)[0];
      const delay = Math.max(1, Math.min(15, 3000 / Math.max(1, seqs.length)));
      const batch = Math.max(1, Math.ceil(seqs.length / (3000 / Math.max(delay, 16))));
      const next = new Map<number, BlockState>();
      for (let i = 0; i < seqs.length; i += batch) {
        if (cancel.current) break;
        for (const s of seqs.slice(i, i + batch)) next.set(s, firstCrit != null && s >= firstCrit ? (s === firstCrit || results.get(s) === false ? "fail" : "pending") : results.get(s) === false ? "fail" : "ok");
        setStates(new Map(next));
        setFocus(seqs[Math.min(seqs.length - 1, i + batch - 1)]);
        await new Promise((res) => setTimeout(res, Math.max(delay, 16)));
      }
      if (firstCrit != null) { next.set(firstCrit, "fail"); setStates(new Map(next)); setFocus(firstCrit); }
      setReport(r);
      recordServer.mutate();
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  };
  useEffect(() => () => { cancel.current = true; }, []);

  const crit = report?.findings.filter((f) => f.severity === "critical") ?? [];
  const tone = report ? (report.status === "valid" ? "valid" : report.status === "warning" ? "warning" : "tampered") : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="Chain & verifier" actions={
        <>
          <div className="flex rounded-[2px] border border-line-2 text-xs" role="group" aria-label="Verification mode">
            {(["standard", "deep"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cx("px-3 py-1.5", mode === m ? "bg-panel-2 text-accent" : "text-muted hover:text-text")}>{m}</button>
            ))}
          </div>
          {(info.data?.signing.inline || info.data?.signing.function) && <Button variant="gold" onClick={() => seal.mutate()} loading={seal.isPending}><IconSeal /> Seal now</Button>}
          <Button variant="primary" onClick={verify} loading={running}><IconShield /> Verify in this browser</Button>
        </>
      }>
        Verification runs here, with WebCrypto. It downloads the entries and checkpoints, recomputes every hash, Merkle root and signature, and replays derived state. It trusts nothing the server says.
        {mode === "deep" && " Deep mode also downloads every vector and checks its hash."}
      </PageHeader>

      <Card title={`${blocks.length} entries · ${cpSizes.length} checkpoints`} state={tone}>
        <div className="p-4">
          {chain.isLoading ? <Skeleton className="h-20" /> : blocks.length ? (
            <ChainStrip blocks={blocks} checkpoints={cpSizes} states={states} focusSeq={focus} onOpen={(seq) => open(`m_${space}_${String(seq).padStart(12, "0")}`)} />
          ) : <p className="text-xs text-muted">The chain is empty.</p>}
          <div className="mt-3 flex flex-wrap gap-4 text-2xs text-muted">
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-[2px] border-2 border-accent bg-accent/10" /> memory</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-[2px] border-2 border-accent/40" /> superseded</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-[2px] border-2 border-violet" /> summary</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-[2px] border border-dashed border-muted" /> forget</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-[2px] border border-line-2" /> link</span>
            <span className="flex items-center gap-1.5 text-gold"><IconSeal size={11} /> checkpoint</span>
          </div>
        </div>
      </Card>

      <ErrorNote error={error} />

      {report && (
        <Card title="Result" state={tone}>
          <div className="p-4">
            <div className={cx("flex items-center gap-2 text-lg", report.status === "valid" && "text-valid", report.status === "warning" && "text-warn", report.status === "tampered" && "text-tamper")}>
              {report.status === "valid" ? <IconTick size={20} /> : <IconAlert size={20} />}
              {report.status === "valid" && `Verified through #${report.validThrough}.${report.latestCheckpoint ? ` Signed ${when(report.latestCheckpoint.createdAt)}.` : ""}`}
              {report.status === "warning" && `Hashes verify through #${report.validThrough}; derived fields disagree with the chain.`}
              {report.status === "tampered" && (crit[0]?.rule === "truncation" ? crit[0].message : `Memory #${crit[0]?.seq} was changed after it was written.`)}
            </div>
            <p className="mt-1 text-xs text-muted">{report.entries} entries checked in {report.mode} mode · {report.checkpointsValid}/{report.checkpointsTotal} checkpoints valid · {report.findings.length} findings</p>
          </div>
          {report.findings.length > 0 && (
            <table className="w-full border-t border-line text-xs">
              <thead><tr className="text-left"><th className="label px-4 py-2">Severity</th><th className="label px-2 py-2">Seq</th><th className="label px-2 py-2">Rule</th><th className="label px-2 py-2">What happened</th></tr></thead>
              <tbody>
                {report.findings.map((f, i) => (
                  <tr key={i} className="border-t border-line align-top hover:bg-panel-2">
                    <td className="px-4 py-2"><Pill tone={f.severity === "critical" ? "tampered" : f.severity === "warning" ? "warning" : "accent"}>{f.severity}</Pill></td>
                    <td className="px-2 py-2 tabular"><button className="text-accent hover:underline" onClick={() => { setFocus(f.seq); open(`m_${space}_${String(f.seq).padStart(12, "0")}`); }}>#{f.seq}</button></td>
                    <td className="px-2 py-2 text-muted">{f.rule}</td>
                    <td className="px-2 py-2">{f.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Signed checkpoints" className="lg:col-span-2">
          {cps.isLoading && <div className="p-4"><Skeleton className="h-16" /></div>}
          {cps.data && !cps.data.checkpoints.length && <p className="p-4 text-xs text-muted">No checkpoints yet. The checkpoint Function signs one every few minutes and after every {info.data?.settings.checkpointEvery ?? 16} writes.</p>}
          {cps.data && cps.data.checkpoints.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left"><th className="label px-4 py-2">Seq</th><th className="label px-2 py-2">Size</th><th className="label px-2 py-2">Root</th><th className="label px-2 py-2">Signed</th><th className="label px-2 py-2">Signature</th><th className="label px-2 py-2">Anchor</th></tr></thead>
                <tbody>
                  {[...cps.data.checkpoints].reverse().map((c) => (
                    <tr key={c.seq} className="border-t border-line">
                      <td className="px-4 py-2 tabular text-gold">#{Number(c.seq)}</td>
                      <td className="px-2 py-2 tabular">{Number(c.size)}</td>
                      <td className="px-2 py-2"><code title={c.root}>{shortHash(c.root)}</code></td>
                      <td className="px-2 py-2 text-muted">{when(c.createdAt)}</td>
                      <td className="px-2 py-2">{!pub ? <span className="text-muted">no key</span> : sigs.get(c.seq) == null ? "…" : sigs.get(c.seq) ? <span className="text-valid"><IconTick className="inline" /> valid</span> : <span className="text-tamper"><IconCross className="inline" /> invalid</span>}</td>
                      <td className="px-2 py-2">{c.anchor ? <a className="inline-flex items-center gap-1 text-accent hover:underline" href={`https://github.com/${c.anchor.repo}/commit/${c.anchor.commit}`} target="_blank" rel="noreferrer">GitHub <IconExternal size={11} /></a> : <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Public key" state="sealed">
          <div className="space-y-3 p-4 text-xs">
            {pub ? (
              <div className="flex items-start gap-1"><code className="break-all text-gold">{pub}</code><CopyButton value={pub} /></div>
            ) : <p className="text-warn">No public key configured. Set NEXT_PUBLIC_CP_PUBLIC_KEY to let verifiers check signatures.</p>}
            <p className="text-muted">Key ID {info.data?.keyId}. The signing key never touches the database; only the checkpoint Function holds it.</p>
            {info.data?.settings.publicVerify ? (
              <Link href={`/verify/${space}`} className="inline-flex items-center gap-1 text-accent hover:underline">Open the public verifier <IconExternal size={11} /></Link>
            ) : <p className="text-muted">Public verification is off. Turn it on in Settings to share a no-login verifier.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
