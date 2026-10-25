"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, readOk } from "@/lib/client/api";
import { useSpaceInfo } from "@/lib/client/hooks";
import { when } from "@/lib/format";
import { MembersCard } from "@/components/members-card";
import { PageHeader } from "@/components/space-shell";
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Skeleton, Textarea, Toggle, useToast } from "@/components/ui";

const RANGES = [
  { key: "neighbourDistance", label: "Neighbour distance", min: 0.05, max: 0.9, step: 0.01, help: "How close an existing memory must be before Engram checks it for duplicates, supersessions and conflicts. Lower is stricter. Default 0.35." },
  { key: "duplicateDistance", label: "Duplicate distance", min: 0, max: 0.3, step: 0.005, help: "Below this distance, with the same kind and subject, a new memory is a duplicate without asking the model. Default 0.06." },
  { key: "conceptDistance", label: "Concept distance", min: 0.05, max: 0.9, step: 0.01, help: "How close a memory must be to a concept's centre to join it. Default 0.30." },
  { key: "checkpointEvery", label: "Checkpoint interval", min: 1, max: 1000, step: 1, help: "Sign a checkpoint after this many new entries, in addition to the scheduled run. Default 16." },
] as const;

type Num = { neighbourDistance: number; duplicateDistance: number; conceptDistance: number; checkpointEvery: number };
type Section = "space" | "thresholds" | "publicVerify" | "anchoring";

export function SettingsView() {
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
  const [password, setPassword] = useState("");
  // Fill the form once per space: a background refetch (window refocus) must not overwrite unsaved edits.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!s || filledFor.current === space) return;
    filledFor.current = space;
    setName(s.name); setDescription(s.description);
    setNums({ neighbourDistance: s.neighbourDistance, duplicateDistance: s.duplicateDistance, conceptDistance: s.conceptDistance, checkpointEvery: s.checkpointEvery });
    setClassifier(s.classifierModel ?? ""); setRetention(s.retentionDays);
  }, [s, space]);
  // One mutation per section, so each Save shows its own spinner and error.
  const useSave = (section: Section) => useMutation({
    mutationKey: ["settings", space, section],
    mutationFn: (patch: Record<string, unknown>) => api(`/api/app/spaces/${space}/settings`, { method: "PATCH", json: patch }),
    onSuccess: () => { toast("Settings saved.", "ok"); qc.invalidateQueries({ queryKey: ["space", space] }); qc.invalidateQueries({ queryKey: ["spaces"] }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const saveSpace = useSave("space");
  const saveThresholds = useSave("thresholds");
  const savePublic = useSave("publicVerify");
  const saveAnchoring = useSave("anchoring");
  const repair = useMutation({ mutationFn: () => api<{ fixed: number; erased: number }>(`/api/app/spaces/${space}/repair`, { method: "POST" }), onSuccess: (r) => toast(`Rebuilt derived state for ${r.fixed} entries${r.erased ? `, erased ${r.erased}` : ""}.`, "ok") });
  const del = useMutation({ mutationFn: () => api(`/api/app/spaces/${space}`, { method: "DELETE", json: { password } }), onSuccess: () => { qc.clear(); router.push("/app"); } });
  // Export as a download, so a rate limit or server error becomes a message instead of a raw JSON page.
  const exportJson = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/app/spaces/${space}/export`, { credentials: "same-origin" });
      if (!res.ok) await readOk(res);
      const blob = await res.blob();
      const file = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `engram-${space}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = file;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return file;
    },
    onSuccess: (file) => toast(`Downloaded ${file}.`, "ok"),
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });

  if (info.error) {
    return (
      <Card>
        <Empty title="Settings could not be loaded" action={<Button onClick={() => void info.refetch()} loading={info.isFetching}>Try again</Button>}>
          {info.error instanceof Error ? info.error.message : String(info.error)}
        </Empty>
      </Card>
    );
  }
  if (!s || !nums) return <Skeleton className="h-96" />;
  // The server accepts only these models; a saved model that is no longer allowed stays visible so it can be changed.
  const models = [...new Set([...(info.data?.allowedModels ?? []), ...(s.classifierModel ? [s.classifierModel] : [])])];
  return (
    <div className="space-y-4">
      <PageHeader title="Settings">{owner ? undefined : "You can see this space's settings. Only the owner can change them."}</PageHeader>
      <Card title="Space">
        <form className="grid gap-4 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveSpace.mutate({ name, description }); }}>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!owner || saveSpace.isPending} minLength={2} maxLength={64} /></Field>
          <Field label="Space key"><Input value={space} readOnly /></Field>
          <div className="md:col-span-2"><Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!owner || saveSpace.isPending} maxLength={300} /></Field></div>
          {owner && <div><Button type="submit" variant="primary" loading={saveSpace.isPending}>Save</Button></div>}
        </form>
      </Card>

      <MembersCard space={space} owner={owner} sandbox={!!s?.sandbox} />

      <Card title="Thresholds">
        <form className="grid gap-5 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveThresholds.mutate({ ...nums, classifierModel: classifier.trim() || null, retentionDays: retention }); }}>
          {RANGES.map((r) => (
            <Field key={r.key} label={`${r.label}: ${nums[r.key]}`} help={r.help}>
              <input type="range" min={r.min} max={r.max} step={r.step} value={nums[r.key]} disabled={!owner || saveThresholds.isPending} className="w-full accent-[#0a0a0a]"
                onChange={(e) => setNums({ ...nums, [r.key]: Number(e.target.value) })} />
            </Field>
          ))}
          <Field label="Classifier model" help={models.length ? "Models this server allows. The deployment default is used when none is chosen; with no model key, a rule-based classifier runs." : "This server has no classifier models enabled, so the deployment default (or the rule-based classifier) runs."}>
            <Select value={classifier} onChange={(e) => setClassifier(e.target.value)} disabled={!owner || saveThresholds.isPending || !models.length} className="w-full">
              <option value="">Deployment default</option>
              {models.map((m) => <option key={m} value={m}>{m}{info.data?.allowedModels && !info.data.allowedModels.includes(m) ? " (no longer allowed)" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Retention (days)" help="0 keeps everything. Otherwise the sentinel writes forget entries for older memories; nothing is ever deleted.">
            <Input type="number" required min={0} max={3650} step={1} value={retention} onChange={(e) => setRetention(Number(e.target.value))} disabled={!owner || saveThresholds.isPending} />
          </Field>
          {owner && <div><Button type="submit" variant="primary" loading={saveThresholds.isPending}>Save thresholds</Button></div>}
        </form>
      </Card>

      <Card title="Verification">
        <div className="space-y-4 p-4 text-xs">
          <div className="flex items-center justify-between gap-4">
            <div><div>Public verification</div><div className="text-2xs text-muted">Anyone can verify this space at /verify/{space} without logging in. Only header fields and hashes are shared, never memory text.</div></div>
            <Toggle checked={savePublic.isPending ? !!savePublic.variables?.publicVerify : s.publicVerify} disabled={!owner || savePublic.isPending} onChange={(v) => savePublic.mutate({ publicVerify: v })} label="Public verification" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div><div>GitHub anchoring</div><div className="text-2xs text-muted">Hourly, commit the latest checkpoint root to a public repository: an outside timestamp the operator cannot rewrite. {s.lastAnchorAt ? `Last anchored ${when(s.lastAnchorAt)}.` : "Requires GITHUB_ANCHOR_TOKEN and GITHUB_ANCHOR_REPO in the checkpoint Function."}</div></div>
            <Toggle checked={saveAnchoring.isPending ? !!saveAnchoring.variables?.anchoring : s.anchoring} disabled={!owner || saveAnchoring.isPending} onChange={(v) => saveAnchoring.mutate({ anchoring: v })} label="GitHub anchoring" />
          </div>
          <div className="text-2xs text-muted">Signing: {info.data?.signing.function ? "checkpoint Function" : info.data?.signing.inline ? "this deployment (inline key)" : "not configured"} · Backend: {info.data?.backend}</div>
        </div>
      </Card>

      <Card title="Data">
        <div className="flex flex-wrap gap-3 p-4">
          <Button onClick={() => exportJson.mutate()} loading={exportJson.isPending}>Export JSON</Button>
          {owner && <Button onClick={() => repair.mutate()} loading={repair.isPending}>Rebuild derived state</Button>}
          <ErrorNote error={repair.error} />
          <p className="w-full text-2xs text-muted">Rebuild replays the chain and rewrites status, validity and conflict fields that disagree with it, and finishes any pending erasure. It never touches hashed fields. Run it only after reviewing verifier warnings: it removes the evidence of a derived-field tamper.</p>
        </div>
      </Card>

      {owner && (
        <Card title="Danger zone" state="tampered">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
            <div><div className="text-tamper">Delete this space</div><div className="text-2xs text-muted">Removes every entry, concept, recall log and checkpoint file. This cannot be undone.</div></div>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete space</Button>
          </div>
        </Card>
      )}
      <Modal open={confirmDelete} onClose={() => { setConfirmDelete(false); setPassword(""); setTyped(""); del.reset(); }} title="Delete space">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (typed === s.name && password) del.mutate(); }}>
          <p className="text-xs text-muted">Type <span className="text-text">{s.name}</span> to confirm.</p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Space name" />
          <Field label="Your password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <ErrorNote error={del.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => { setConfirmDelete(false); setPassword(""); setTyped(""); del.reset(); }}>Cancel</Button><Button type="submit" variant="danger" disabled={typed !== s.name || !password} loading={del.isPending}>Delete forever</Button></div>
        </form>
      </Modal>
    </div>
  );
}
