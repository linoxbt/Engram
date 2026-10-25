"use client";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { api } from "@/lib/client/api";
import { pca2 } from "@/lib/client/pca";
import { Feed, type FeedItem } from "@/components/feed";
import { IconReflect, IconSearch } from "@/components/icons";
import { PageHeader, useOpenMemory } from "@/components/space-shell";
import { Button, Card, Empty, ErrorNote, Input, Skeleton, useToast } from "@/components/ui";

interface GNode { id: string; label: string; summary: string; members: number; vector: number[] }
interface GEdge { a: string; b: string; weight: number; conflict: boolean }
type SimNode = SimulationNodeDatum & GNode & { r: number };
type SimLink = SimulationLinkDatum<SimNode> & { conflict: boolean; weight: number };

export default function ConceptsPage() {
  const { space } = useParams<{ space: string }>();
  const open = useOpenMemory();
  const qc = useQueryClient();
  const toast = useToast();
  const g = useQuery({ queryKey: ["space", space, "concepts"], queryFn: () => api<{ nodes: GNode[]; edges: GEdge[] }>(`/api/app/spaces/${space}/concepts`) });
  const [sel, setSel] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const members = useQuery({ enabled: !!sel, queryKey: ["space", space, "concept", sel], queryFn: () => api<{ members: FeedItem[] }>(`/api/app/spaces/${space}/concepts/${sel}`) });
  const relabel = useMutation({ mutationFn: (id: string) => api(`/api/app/spaces/${space}/concepts/${id}`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["space", space, "concepts"] }) });
  const reflect = useMutation({
    mutationFn: (id: string) => api<{ seq: number }>(`/api/app/spaces/${space}/concepts/${id}/reflect`, { method: "POST" }),
    onSuccess: (r) => { toast(`Summary written as entry #${r.seq}, linked to its sources.`, "ok"); qc.invalidateQueries({ queryKey: ["space", space] }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const node = g.data?.nodes.find((n) => n.id === sel);

  return (
    <div className="space-y-4">
      <PageHeader title="Concept map">Memories cluster into concepts online as they arrive. Positions come from a PCA projection of concept centroids, settled by a force layout. Red edges join concepts in open conflict.</PageHeader>
      <ErrorNote error={g.error} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title={`${g.data?.nodes.length ?? 0} concepts`} action={
          <form className="relative" onSubmit={(e) => e.preventDefault()}><IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" /><Input aria-label="Highlight concepts" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="highlight…" className="h-7 w-44 pl-7 text-xs" /></form>
        }>
          {g.isLoading ? <Skeleton className="m-4 h-[480px]" /> : g.data && g.data.nodes.length ? (
            <Graph nodes={g.data.nodes} edges={g.data.edges} selected={sel} onSelect={setSel} highlight={search.trim().toLowerCase()} />
          ) : <Empty title="No concepts yet">Concepts appear as memories are written.</Empty>}
        </Card>
        <Card title={node ? node.label : "Select a concept"}>
          {!node ? <p className="p-4 text-xs text-muted">Click a node to list its memories. Drag to pan, scroll to zoom.</p> : (
            <div>
              <div className="space-y-2 border-b border-line p-4 text-xs">
                <p className="text-muted">{node.summary || "Not labelled yet."}</p>
                <p className="text-2xs text-muted">{node.members} members</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => relabel.mutate(node.id)} loading={relabel.isPending}>Relabel</Button>
                  <Button size="sm" variant="outline" onClick={() => reflect.mutate(node.id)} loading={reflect.isPending}><IconReflect /> Reflect</Button>
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto">{members.isLoading ? <Skeleton className="m-4 h-20" /> : <Feed items={members.data?.members ?? []} onOpen={open} />}</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Graph({ nodes, edges, selected, onSelect, highlight }: { nodes: GNode[]; edges: GEdge[]; selected: string | null; onSelect: (id: string) => void; highlight: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const touched = useRef(false);
  const sim = useRef<{ nodes: SimNode[]; links: SimLink[] } | null>(null);
  const draw = useRef<() => void>(() => {});
  const H = 480;

  const seeded = useMemo(() => {
    const pos = pca2(nodes.map((n) => n.vector));
    const xs = pos.map((p) => p[0]), ys = pos.map((p) => p[1]);
    const sx = (Math.max(...xs) - Math.min(...xs)) || 1, sy = (Math.max(...ys) - Math.min(...ys)) || 1;
    return nodes.map((n, i) => ({ ...n, x: ((pos[i][0] - Math.min(...xs)) / sx - 0.5) * 500, y: ((pos[i][1] - Math.min(...ys)) / sy - 0.5) * 340, r: 6 + Math.sqrt(n.members) * 3.2 })) as SimNode[];
  }, [nodes]);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const byId = new Map(seeded.map((n) => [n.id, n]));
    const links: SimLink[] = edges.filter((e) => byId.has(e.a) && byId.has(e.b)).map((e) => ({ source: byId.get(e.a)!, target: byId.get(e.b)!, conflict: e.conflict, weight: e.weight }));
    sim.current = { nodes: seeded, links };
    const resize = () => { const dpr = window.devicePixelRatio || 1; c.width = c.clientWidth * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw.current(); };
    draw.current = () => {
      const w = c.clientWidth;
      const { x, y, k } = view.current;
      ctx.clearRect(0, 0, w, H);
      ctx.save();
      ctx.translate(w / 2 + x, H / 2 + y);
      ctx.scale(k, k);
      for (const l of links) {
        const s = l.source as SimNode, t = l.target as SimNode;
        ctx.strokeStyle = l.conflict ? "rgba(215,38,61,0.85)" : `rgba(10,10,10,${0.18 + (l.weight - 0.75) * 1.2})`;
        ctx.lineWidth = l.conflict ? 2 / k : 1 / k;
        ctx.beginPath(); ctx.moveTo(s.x!, s.y!); ctx.lineTo(t.x!, t.y!); ctx.stroke();
      }
      for (const n of seeded) {
        const hit = highlight && n.label.toLowerCase().includes(highlight);
        const dim = highlight && !hit;
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.id === selected ? "rgba(10,10,10,0.9)" : "rgba(255,255,255,1)";
        ctx.fill();
        ctx.lineWidth = (n.id === selected || hit ? 2.5 : 1.2) / k;
        ctx.strokeStyle = hit ? "#946d00" : "#0a0a0a";
        ctx.stroke();
        if (k > 0.6 || n.members > 4) {
          ctx.fillStyle = "#0a0a0a";
          ctx.font = `${11 / k}px JetBrains Mono, monospace`;
          ctx.textAlign = "center";
          ctx.fillText(n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label, n.x!, n.y! + n.r + 12 / k);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    };
    const s = forceSimulation(seeded)
      .force("charge", forceManyBody().strength(-60))
      .force("link", forceLink<SimNode, SimLink>(links).distance(70).strength((l) => (l.conflict ? 0.05 : 0.3)))
      .force("collide", forceCollide<SimNode>((n) => n.r + 8))
      .force("center", forceCenter(0, 0))
      .alpha(0.6).alphaDecay(0.04)
      .on("tick", () => draw.current())
      .on("end", () => {
        if (touched.current || !seeded.length) return;
        // Fit every node in view once the layout settles.
        const pad = 40, w = c.clientWidth;
        const xs = seeded.flatMap((n) => [n.x! - n.r, n.x! + n.r]), ys = seeded.flatMap((n) => [n.y! - n.r, n.y! + n.r + 16]);
        const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
        const k = Math.min(2, Math.max(0.3, Math.min((w - pad * 2) / bw, (H - pad * 2) / bh)));
        view.current = { k, x: -((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: -((Math.max(...ys) + Math.min(...ys)) / 2) * k };
        draw.current();
      });
    resize();
    window.addEventListener("resize", resize);
    return () => { s.stop(); window.removeEventListener("resize", resize); };
  }, [seeded, edges, selected, highlight]);

  // Pan, zoom and select.
  useEffect(() => {
    const c = canvas.current!;
    let dragging = false, moved = false, lx = 0, ly = 0;
    const toWorld = (ex: number, ey: number) => {
      const r = c.getBoundingClientRect(); const { x, y, k } = view.current;
      return [(ex - r.left - r.width / 2 - x) / k, (ey - r.top - H / 2 - y) / k];
    };
    const down = (e: PointerEvent) => { dragging = true; moved = false; touched.current = true; lx = e.clientX; ly = e.clientY; };
    const move = (e: PointerEvent) => { if (!dragging) return; const dx = e.clientX - lx, dy = e.clientY - ly; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; view.current.x += dx; view.current.y += dy; lx = e.clientX; ly = e.clientY; draw.current(); };
    const up = (e: PointerEvent) => {
      dragging = false;
      if (moved) return;
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      const hit = sim.current?.nodes.find((n) => Math.hypot(n.x! - wx, n.y! - wy) <= n.r + 4);
      if (hit) onSelect(hit.id);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); touched.current = true; const k = Math.min(4, Math.max(0.3, view.current.k * (e.deltaY < 0 ? 1.1 : 0.9))); view.current.k = k; draw.current(); };
    c.addEventListener("pointerdown", down); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); c.addEventListener("wheel", wheel, { passive: false });
    return () => { c.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); c.removeEventListener("wheel", wheel); };
  }, [onSelect]);

  return (
    <div>
      <canvas ref={canvas} className="block w-full cursor-grab touch-none active:cursor-grabbing" style={{ height: H }} role="img" aria-label={`Concept map with ${nodes.length} concepts`} />
      <ul className="sr-only">{nodes.map((n) => <li key={n.id}><button onClick={() => onSelect(n.id)}>{n.label}, {n.members} memories</button></li>)}</ul>
    </div>
  );
}
