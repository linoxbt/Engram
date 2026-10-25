"use client";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { IconExternal, IconShield } from "@/components/icons";
import { IntegrityBadge } from "@/components/integrity-badge";
import { Button, Card, ErrorNote, PageHeader, Pill, Skeleton, Stat } from "@/components/ui";
import { NoSpaces, StorageNotice } from "@/components/workspace-ui";
import { ago } from "@/lib/format";
import { storageDown, useHealth, useSpaces } from "@/lib/client/workspace";

export function View() {
  const qc = useQueryClient();
  const spaces = useSpaces();
  const health = useHealth();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const list = spaces.data?.spaces ?? [];
  const count = (st: string) => list.filter((s) => s.integrity?.status === st).length;
  const unchecked = list.filter((s) => !s.integrity).length;
  const sealed = list.reduce((n, s) => n + (s.latestCheckpoint?.size ?? 0), 0);

  const recheck = async () => {
    setError(null);
    try {
      for (const s of list) {
        setRunning(s.key);
        await api(`/api/app/spaces/${s.key}/verify`, { method: "POST" });
      }
    } catch (e) {
      setError(e);
    } finally {
      setRunning(null);
      qc.invalidateQueries({ queryKey: ["spaces"] });
    }
  };

  return (
    <>
      <PageHeader title="Integrity" actions={list.length > 0 && (
        <Button variant="primary" onClick={recheck} loading={running != null} disabled={storageDown(health.data)}>
          <IconShield /> {running ? `Checking ${list.find((s) => s.key === running)?.name ?? ""}…` : "Re-check all spaces"}
        </Button>
      )}>
        The integrity of every space at a glance. Each check recomputes every hash, Merkle root and Ed25519 signature on the chain. For a check that trusts nothing the server says, run the verifier in your browser from a space&apos;s Chain page.
      </PageHeader>
      <StorageNotice health={health.data} />
      <ErrorNote error={error} />
      {spaces.isLoading && <Skeleton className="h-40" />}
      {spaces.data && !list.length ? <NoSpaces /> : list.length > 0 && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Spaces" value={list.length} />
            <Stat label="Verified" value={count("valid")} tone="valid" />
            <Stat label="With warnings" value={count("warning")} tone={count("warning") ? "warn" : "muted"} hint="Hashes verify, but something was flagged (for example derived fields that disagree with the chain)" />
            <Stat label="Tampered" value={count("tampered")} tone={count("tampered") ? "tamper" : "muted"} />
            <Stat label="Not checked" value={unchecked} tone="muted" />
            <Stat label="Sealed entries" value={sealed} tone="gold" hint="Entries covered by the latest signed checkpoint of each space" />
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead><tr className="border-b border-line text-left"><th className="label px-4 py-2 font-normal">Space</th><th className="label px-2 py-2 font-normal">Status</th><th className="label px-2 py-2 font-normal">Latest checkpoint</th><th className="label px-2 py-2 font-normal">Last check</th><th className="px-4 py-2" /></tr></thead>
                <tbody className="divide-y divide-line">
                  {list.map((s) => (
                    <tr key={s.key} className={running === s.key ? "bg-panel-2" : undefined}>
                      <td className="px-4 py-3">
                        <Link href={`/app/${s.key}`} className="hover:underline">{s.name}</Link>
                        <div className="mt-0.5 flex gap-1 text-2xs text-muted"><span className="tabular">{s.key}</span>{s.sandbox && <Pill tone="warning">sandbox</Pill>}</div>
                      </td>
                      <td className="px-2 py-3"><IntegrityBadge integrity={s.integrity} /></td>
                      <td className="px-2 py-3 text-muted">{s.latestCheckpoint ? <span className="text-gold">{s.latestCheckpoint.size} sealed · {ago(s.latestCheckpoint.createdAt)}</span> : "none yet"}</td>
                      <td className="px-2 py-3 text-muted">{s.integrity ? ago(s.integrity.checkedAt) : "never"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-3 text-2xs">
                          <Link href={`/app/${s.key}/chain`} className="text-text hover:underline">Verify in browser</Link>
                          {s.publicVerify && <Link href={`/verify/${s.key}`} className="flex items-center gap-1 text-muted hover:text-text">Public page <IconExternal size={11} /></Link>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
