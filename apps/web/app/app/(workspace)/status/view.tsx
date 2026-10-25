"use client";
import clsx from "clsx";
import type { ReactNode } from "react";
import { IconAlert, IconTick } from "@/components/icons";
import { Button, Card, PageHeader, Skeleton } from "@/components/ui";
import { useHealth } from "@/lib/client/workspace";

function Row({ name, what, ok, detail, fix }: { name: string; what: string; ok: boolean | null; detail?: ReactNode; fix?: ReactNode }) {
  return (
    <li className="flex gap-3 px-4 py-3.5">
      <span className={clsx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", ok == null ? "bg-panel-2 text-muted" : ok ? "bg-valid/15 text-valid" : "bg-warn/15 text-warn")}>
        {ok === false ? <IconAlert size={11} /> : <IconTick size={11} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs text-text">{name}</span>
          <span className={clsx("text-2xs", ok == null ? "text-muted" : ok ? "text-valid" : "text-warn")}>{detail}</span>
        </div>
        <p className="mt-0.5 text-2xs text-muted">{what}</p>
        {fix && <p className="mt-1.5 rounded-[2px] border border-line bg-panel px-2.5 py-1.5 text-2xs text-text">{fix}</p>}
      </div>
    </li>
  );
}

export function View() {
  const h = useHealth();
  const d = h.data;
  const ms = (c?: { ok: boolean; ms: number }) => (c ? (c.ok ? `operational · ${c.ms} ms` : "unavailable") : "—");
  const appwrite = d?.backend === "appwrite";

  return (
    <>
      <PageHeader title="Status" actions={<Button onClick={() => h.refetch()} loading={h.isFetching}>Re-run checks</Button>}>
        Live checks against the services Engram runs on. They run on the server each time you open this page.
      </PageHeader>
      {h.isLoading && <Skeleton className="h-72" />}
      {d && (
        <>
          <div className={clsx("mb-5 flex items-center gap-3 rounded-[2px] border px-4 py-3", d.ok ? "border-valid/40 bg-valid/5" : "border-warn/50 bg-warn/5")}>
            <span className={clsx("size-2.5 rounded-full", d.ok ? "bg-valid" : "bg-warn")} />
            <div className="text-xs">
              <div className={d.ok ? "text-valid" : "text-warn"}>{d.ok ? "All systems operational" : "Some services need attention"}</div>
              <div className="mt-0.5 text-2xs text-muted">Backend: {appwrite ? "Appwrite Cloud" : "local demo store (temporary on serverless hosts)"}</div>
            </div>
          </div>
          <Card title="Services">
            <ul className="divide-y divide-line">
              <Row name="Memory storage" what="Appwrite VectorsDB: memories, concepts, agents and recall logs, searchable by meaning." ok={d.database?.ok ?? null} detail={ms(d.database)}
                fix={d.database && !d.database.ok ? <>VectorsDB runs on a dedicated database, which needs the Appwrite Pro plan (organization → Billing → upgrade). Then run <code>pnpm setup:appwrite</code> to create the database and collections.</> : undefined} />
              <Row name="Embeddings" what="Appwrite Embeddings turn text into vectors for storage and recall." ok={d.embeddings?.ok ?? null} detail={ms(d.embeddings)}
                fix={d.embeddings && !d.embeddings.ok ? d.embeddings.error : undefined} />
              <Row name="Checkpoint storage" what="Appwrite Storage keeps signed checkpoint files and exports." ok={d.storage?.ok ?? null} detail={ms(d.storage)}
                fix={d.storage && !d.storage.ok ? d.storage.error : undefined} />
              <Row name="Checkpoint signing" what="An Appwrite Function signs the Merkle root with an Ed25519 key the database never sees." ok={d.signing ? d.signing.checkpointFunction || d.signing.inlineKey : null}
                detail={d.signing ? (d.signing.checkpointFunction ? "Appwrite Function" : d.signing.inlineKey ? "inline key" : "not configured") : "—"}
                fix={d.signing && !d.signing.checkpointFunction && !d.signing.inlineKey ? <>Deploy the checkpoint Function with <code>pnpm functions:deploy</code> and set <code>CHECKPOINT_FUNCTION_ID</code>.</> : undefined} />
              <Row name="Public verification key" what="Browsers use it to check checkpoint signatures without trusting the server." ok={d.signing ? d.signing.publicKey : null} detail={d.signing?.publicKey ? "published" : "missing"}
                fix={d.signing && !d.signing.publicKey ? <>Set <code>NEXT_PUBLIC_CP_PUBLIC_KEY</code> to the checkpoint public key and redeploy.</> : undefined} />
              <Row name="Relation classifier" what="Decides whether a new memory duplicates, supersedes, contradicts or refines its neighbours."
                ok={d.classifier === "heuristic" ? true : d.classifierCheck?.ok ?? null}
                detail={d.classifier === "heuristic" ? "rule-based" : d.classifierCheck ? `${d.classifier} · ${d.classifierCheck.ok ? `${d.classifierCheck.ms} ms` : "unavailable"}` : d.classifier}
                fix={d.classifier === "heuristic"
                  ? <>Using built-in rules. Set <code>CLASSIFIER_MODEL</code> and <code>MODEL_API_KEY</code> for model-based classification.</>
                  : d.classifierCheck && !d.classifierCheck.ok
                    ? <>{d.classifierCheck.error} Until this is fixed, new memories are classified with the built-in rules in the background. If the message mentions a workspace, set <code>ANTHROPIC_WORKSPACE_ID</code>.</>
                    : undefined} />
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
