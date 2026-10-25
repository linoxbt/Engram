"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { finishSeeding, type SeedState } from "@/lib/client/seed";
import { useHealth, useSpaces } from "@/lib/client/workspace";
import { ago } from "@/lib/format";
import { IconLab, IconPlus, IconShield } from "@/components/icons";
import { IntegrityBadge } from "@/components/integrity-badge";
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, Pill, Skeleton, Textarea, Toggle, CopyButton } from "@/components/ui";

export function SpacesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const q = useSpaces();
  const health = useHealth();
  const [mode, setMode] = useState<null | "space" | "sandbox">(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [publicVerify, setPublicVerify] = useState(false);
  const [demo, setDemo] = useState(false);
  const [keys, setKeys] = useState<{ key: string; agentKeys: Record<string, string> } | null>(null);
  const [seedProgress, setSeedProgress] = useState<{ done: number; total: number } | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      setSeedProgress(null);
      const r = await api<{ key: string; agentKeys: Record<string, string>; seeding: SeedState | null }>("/api/app/spaces", { method: "POST", json: { name, description, publicVerify, sandbox: mode === "sandbox", seed: demo ? "demo" : "none" } });
      await finishSeeding(r.key, r.seeding, setSeedProgress);
      return r;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["spaces"] });
      setMode(null);
      if (Object.keys(r.agentKeys).length) setKeys(r);
      else router.push(`/app/${r.key}`);
    },
  });
  const openModal = (m: "space" | "sandbox") => {
    setMode(m);
    setName(m === "sandbox" ? "Tamper Lab sandbox" : "");
    setDescription(m === "sandbox" ? "A disposable copy of the demo story for attacking and verifying." : "");
    setDemo(false);
  };
  return (
    <>
      <div>
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-lg">Spaces</h1>
            <p className="mt-1 text-xs text-muted">A space is a shared memory: one hash chain, many agents.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => openModal("sandbox")}><IconLab /> New sandbox</Button>
            <Button variant="primary" onClick={() => openModal("space")}><IconPlus /> New space</Button>
          </div>
        </div>
        {health.data && health.data.database && !health.data.database.ok && (
          <div role="alert" className="mb-4 rounded-[2px] border border-warn/50 bg-warn/5 px-4 py-3 text-xs text-warn">
            <div className="font-medium">Memory storage is not available yet</div>
            <div className="mt-1 text-muted">{health.data.database.error}</div>
          </div>
        )}
        {health.data?.backend === "local" && (
          <div className="mb-4 rounded-[2px] border border-line-2 px-4 py-2 text-2xs text-muted">Running on the local demo backend. Data on serverless hosts is temporary until Appwrite is configured.</div>
        )}
        {q.isLoading && <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-32" />)}</div>}
        <ErrorNote error={q.error} />
        {q.data && !q.data.spaces.length && (
          <Card>
            <Empty title="No spaces yet" action={<div className="flex gap-2"><Button variant="primary" onClick={() => openModal("space")}>Create a space</Button><Button onClick={() => openModal("sandbox")}>Try the Tamper Lab</Button></div>}>
              Create a space, make an agent key, connect an MCP client and write your first memory. Or start a sandbox with the demo story already in it.
            </Empty>
          </Card>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {q.data?.spaces.map((s) => (
            <Link key={s.key} href={`/app/${s.key}`} className="card block p-4 transition-colors hover:border-accent/50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">{s.name}</div>
                  <div className="text-2xs text-muted tabular">{s.key} · created {ago(s.createdAt)}</div>
                </div>
                <div className="flex gap-1">{s.sandbox && <Pill tone="warning">sandbox</Pill>}{s.publicVerify && <Pill tone="gold">public</Pill>}</div>
              </div>
              {s.description && <p className="mt-2 line-clamp-2 text-xs text-muted">{s.description}</p>}
              <div className="mt-3 flex items-center justify-between">
                <IntegrityBadge integrity={s.integrity} />
                {s.latestCheckpoint && <span className="flex items-center gap-1 text-2xs text-gold"><IconShield size={11} /> {s.latestCheckpoint.size} sealed</span>}
              </div>
            </Link>
          ))}
        </div>
      </div>

      <Modal open={mode != null} onClose={() => setMode(null)} title={mode === "sandbox" ? "New sandbox" : "New space"}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Name"><Input required minLength={2} maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder="Northwind support" /></Field>
          <Field label="Description"><Textarea rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="flex items-center justify-between gap-4">
            <div><div className="text-xs">Public verification</div><div className="text-2xs text-muted">Anyone with the key can verify integrity. Memory text is never exposed.</div></div>
            <Toggle checked={publicVerify} onChange={setPublicVerify} label="Public verification" />
          </div>
          {mode === "space" && (
            <div className="flex items-center justify-between gap-4">
              <div><div className="text-xs">Load the demo story</div><div className="text-2xs text-muted">Northwind, Ada Okafor and 120 background memories, seeded with past timestamps.</div></div>
              <Toggle checked={demo} onChange={setDemo} label="Load demo story" />
            </div>
          )}
          {mode === "sandbox" && <p className="text-2xs text-muted">Sandboxes are seeded with the demo story and unlock the Tamper Lab, where you can deliberately corrupt the chain and watch the verifier catch it.</p>}
          <ErrorNote error={create.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={create.isPending}>{create.isPending && (mode === "sandbox" || demo) ? (seedProgress ? `Writing the story… ${seedProgress.done}/${seedProgress.total}` : "Seeding…") : "Create"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!keys} onClose={() => { if (keys) router.push(`/app/${keys.key}`); }} title="Demo agent keys" wide>
        <p className="mb-3 text-xs text-muted">These keys are shown once. Connect support-agent to Claude Code to play the live part of the demo.</p>
        <ul className="space-y-2">
          {keys && Object.entries(keys.agentKeys).map(([n, k]) => (
            <li key={n} className="panel flex items-center gap-2 px-3 py-2 text-xs"><span className="w-36 text-muted">{n}</span><code className="flex-1 truncate">{k}</code><CopyButton value={k} /></li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => keys && router.push(`/app/${keys.key}`)}>Open the space</Button></div>
      </Modal>
    </>
  );
}
