"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useSpaceInfo } from "@/lib/client/hooks";
import { when } from "@/lib/format";
import { PageHeader } from "@/components/space-shell";
import { Button, Card, ErrorNote, Field, Input, Modal, Skeleton, Textarea, Toggle, useToast } from "@/components/ui";

const RANGES = [
  { key: "neighbourDistance", label: "Neighbour distance", min: 0.05, max: 0.9, step: 0.01, help: "How close an existing memory must be before Engram checks it for duplicates, supersessions and conflicts. Lower is stricter. Default 0.35." },
  { key: "duplicateDistance", label: "Duplicate distance", min: 0, max: 0.3, step: 0.005, help: "Below this distance, with the same kind and subject, a new memory is a duplicate without asking the model. Default 0.06." },
  { key: "conceptDistance", label: "Concept distance", min: 0.05, max: 0.9, step: 0.01, help: "How close a memory must be to a concept's centre to join it. Default 0.30." },
  { key: "checkpointEvery", label: "Checkpoint interval", min: 1, max: 200, step: 1, help: "Sign a checkpoint after this many new entries, in addition to the scheduled run. Default 16." },
] as const;

type Num = { neighbourDistance: number; duplicateDistance: number; conceptDistance: number; checkpointEvery: number };

export default function SettingsPage() {
  const { space } = useParams<{ space: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const info = useSpaceInfo(space);
  const s = info.data?.settings;
  const owner = info.data?.role === "owner";
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nums, setNums] = useState<Num | null>(null);
  const [classifier, setClassifier] = useState("");
  const [retention, setRetention] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!s) return;
    setName(s.name); setDescription(s.description);
    setNums({ neighbourDistance: s.neighbourDistance, duplicateDistance: s.duplicateDistance, conceptDistance: s.conceptDistance, checkpointEvery: s.checkpointEvery });
    setClassifier(s.classifierModel ?? ""); setRetention(s.retentionDays);
  }, [s]);
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api(`/api/app/spaces/${space}/settings`, { method: "PATCH", json: patch }),
    onSuccess: () => { toast("Settings saved.", "ok"); qc.invalidateQueries({ queryKey: ["space", space] }); qc.invalidateQueries({ queryKey: ["spaces"] }); },
  });
  const repair = useMutation({ mutationFn: () => api<{ fixed: number; erased: number }>(`/api/app/spaces/${space}/repair`, { method: "POST" }), onSuccess: (r) => toast(`Rebuilt derived state for ${r.fixed} entries${r.erased ? `, erased ${r.erased}` : ""}.`, "ok") });
  const del = useMutation({ mutationFn: () => api(`/api/app/spaces/${space}`, { method: "DELETE" }), onSuccess: () => { qc.clear(); router.push("/app"); } });

  if (!s || !nums) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <PageHeader title="Settings">{owner ? "Only the owner can change settings." : "You are a member of this space. Only the owner can change settings."}</PageHeader>
      <ErrorNote error={save.error} />
      <Card title="Space">
        <form className="grid gap-4 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ name, description }); }}>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!owner} minLength={2} maxLength={64} /></Field>
          <Field label="Space key"><Input value={space} readOnly /></Field>
          <div className="md:col-span-2"><Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!owner} maxLength={300} /></Field></div>
          {owner && <div><Button type="submit" variant="primary" loading={save.isPending}>Save</Button></div>}
        </form>
      </Card>

      <Card title="Thresholds">
        <div className="grid gap-5 p-4 md:grid-cols-2">
          {RANGES.map((r) => (
            <Field key={r.key} label={`${r.label}: ${nums[r.key]}`} help={r.help}>
              <input type="range" min={r.min} max={r.max} step={r.step} value={nums[r.key]} disabled={!owner} className="w-full accent-[#00c2d1]"
                onChange={(e) => setNums({ ...nums, [r.key]: Number(e.target.value) })} />
            </Field>
          ))}
          <Field label="Classifier model" help='Provider and model, like "anthropic:claude-haiku-5-5" or "openai:gpt-5-mini". Empty uses the deployment default; with no model key, a rule-based classifier runs.'>
            <Input value={classifier} onChange={(e) => setClassifier(e.target.value)} disabled={!owner} placeholder="deployment default" />
          </Field>
          <Field label="Retention (days)" help="0 keeps everything. Otherwise the sentinel writes forget entries for older memories; nothing is ever deleted.">
            <Input type="number" min={0} max={3650} value={retention} onChange={(e) => setRetention(Number(e.target.value))} disabled={!owner} />
          </Field>
          {owner && <div><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...nums, classifierModel: classifier || null, retentionDays: retention })}>Save thresholds</Button></div>}
        </div>
      </Card>

      <Card title="Verification">
        <div className="space-y-4 p-4 text-xs">
          <div className="flex items-center justify-between gap-4">
            <div><div>Public verification</div><div className="text-2xs text-muted">Anyone can verify this space at /verify/{space} without logging in. Only header fields and hashes are shared, never memory text.</div></div>
            <Toggle checked={s.publicVerify} disabled={!owner} onChange={(v) => save.mutate({ publicVerify: v })} label="Public verification" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div><div>GitHub anchoring</div><div className="text-2xs text-muted">Hourly, commit the latest checkpoint root to a public repository: an outside timestamp the operator cannot rewrite. {s.lastAnchorAt ? `Last anchored ${when(s.lastAnchorAt)}.` : "Requires GITHUB_ANCHOR_TOKEN and GITHUB_ANCHOR_REPO in the checkpoint Function."}</div></div>
            <Toggle checked={s.anchoring} disabled={!owner} onChange={(v) => save.mutate({ anchoring: v })} label="GitHub anchoring" />
          </div>
          <div className="text-2xs text-muted">Signing: {info.data?.signing.function ? "checkpoint Function" : info.data?.signing.inline ? "this deployment (inline key)" : "not configured"} · Backend: {info.data?.backend}</div>
        </div>
      </Card>

      <Card title="Data">
        <div className="flex flex-wrap gap-3 p-4">
          <a href={`/api/app/spaces/${space}/export`} className="inline-flex h-9 items-center rounded-[2px] border border-line-2 px-3.5 text-sm hover:border-cyan hover:text-cyan">Export JSON</a>
          {owner && <Button onClick={() => repair.mutate()} loading={repair.isPending}>Rebuild derived state</Button>}
          <p className="w-full text-2xs text-muted">Rebuild replays the chain and rewrites status, validity and conflict fields that disagree with it, and finishes any pending erasure. It never touches hashed fields. Run it only after reviewing verifier warnings: it removes the evidence of a derived-field tamper.</p>
        </div>
      </Card>

      {owner && (
        <Card title="Danger zone" state="tampered">
          <div className="flex items-center justify-between gap-4 p-4 text-xs">
            <div><div className="text-tamper">Delete this space</div><div className="text-2xs text-muted">Removes every entry, concept, recall log and checkpoint file. This cannot be undone.</div></div>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete space</Button>
          </div>
        </Card>
      )}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete space">
        <p className="text-xs text-muted">Type <span className="text-text">{s.name}</span> to confirm.</p>
        <Input className="mt-3" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Space name" />
        <ErrorNote error={del.error} />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" disabled={typed !== s.name} loading={del.isPending} onClick={() => del.mutate()}>Delete forever</Button></div>
      </Modal>
    </div>
  );
}
