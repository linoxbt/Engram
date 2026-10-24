"use client";
import { useEffect, useRef } from "react";

interface Node { u: number; v: number; sx: number; sy: number; y: number; depth: number; crest: number; seen: boolean }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * The hero: a living network of memory nodes rolling like a slow wave, seen in perspective. Near nodes
 * are large and dark, far ones fade into the page; the crest of the wave glows gold. A verification
 * pass sweeps across the mesh, and now and then one node flares red with its links before healing.
 * The surface lifts under the pointer. Pauses offscreen; holds still under reduced motion.
 */
export function WaveMesh({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true;
    let cols = 0, rows = 0, nodes: Node[] = [];
    const pointer = { x: -1e4, y: -1e4 };
    const start = performance.now();
    let tamper = -1, tamperAt = -10;

    const build = () => {
      cols = w < 600 ? 22 : 30;
      rows = w < 600 ? 15 : 16;
      nodes = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          // A little jitter so the triangles read as a natural net, not graph paper.
          const ju = i > 0 && i < cols - 1 ? (Math.random() - 0.5) * 0.5 : 0;
          const jv = j > 0 && j < rows - 1 ? (Math.random() - 0.5) * 0.45 : 0;
          nodes.push({ u: (i + ju) / (cols - 1), v: (j + jv) / (rows - 1), sx: 0, sy: 0, y: 0, depth: 0, crest: 0, seen: false });
        }
      }
    };
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const nw = c.clientWidth, nh = c.clientHeight;
      if (!nw || !nh) return;
      const rebuild = !nodes.length || (nw < 600) !== (w < 600);
      w = nw; h = nh;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (rebuild) build();
    };

    // Camera: a low, gentle perspective so the net fills the stage from the far ridge down to the bottom.
    const NEAR = 2.6, FAR = 4.6, CAM = 1.48;
    const project = (t: number) => {
      // Phones: a longer lens so the net spans its whole stage, from the far ridge (~20%) to the bottom (~95%).
      const narrow = w < 600;
      const f = h * (narrow ? 3.03 : 2.3);
      const horizon = -h * (narrow ? 0.776 : 0.39);
      // Wide enough that even the far edge of the net runs past both sides.
      const spread = (1.3 * w * FAR) / f;
      for (const n of nodes) {
        const d = lerp(FAR, NEAR, n.v);
        const xw = (n.u - 0.5) * spread, zw = d;
        // A gentle swell: taller waves would fold the near rows over the far ones at this camera distance.
        // The far ridge swells more, so its silhouette rolls like a lit horizon.
        const amp = lerp(2.2, 1, n.v);
        let y = amp * (0.085 * Math.sin(xw * 1.15 + t * 0.55) + 0.05 * Math.sin(zw * 1.6 - t * 0.42) + 0.028 * Math.sin((xw + zw) * 2.4 + t * 0.9));
        if (n.seen) {
          const dx = n.sx - pointer.x, dy = n.sy - pointer.y;
          y += 0.07 * Math.exp(-(dx * dx + dy * dy) / 9000);
        }
        n.y = y; n.depth = n.v;
        // The warm glow lives on the far ridge, as in a lit horizon.
        n.crest = clamp01((y - 0.035) / 0.09) * (1 - n.v * 0.75);
        n.sx = w / 2 + (xw / d) * f;
        n.sy = horizon + ((CAM - y) / d) * f;
        n.seen = true;
      }
    };

    const frame = (now: number) => {
      const t = reduce ? 4 : (now - start) / 1000;
      project(t);
      if (!reduce && t - tamperAt > 7.5) {
        const i = 3 + Math.floor(Math.random() * (cols - 6)), j = 3 + Math.floor(Math.random() * (rows - 5));
        tamper = j * cols + i; tamperAt = t;
      }
      const flare = tamper >= 0 && t - tamperAt < 1.8 ? 1 - (t - tamperAt) / 1.8 : 0;
      const sweep = reduce ? -1 : ((t * 0.16) % 1.5) - 0.25; // the verification pass, in u
      ctx.clearRect(0, 0, w, h);

      const edge = (a: Node, b: Node, ai: number, bi: number) => {
        if ((a.sx < -40 && b.sx < -40) || (a.sx > w + 40 && b.sx > w + 40)) return;
        const depth = (a.depth + b.depth) / 2, crest = (a.crest + b.crest) / 2;
        const bad = flare > 0 && (ai === tamper || bi === tamper);
        const alpha = lerp(0.06, 0.34, depth) * (0.8 + crest * 0.6);
        ctx.strokeStyle = bad ? `rgba(215,38,61,${0.25 + 0.5 * flare})` : crest > 0.35 ? `rgba(184,137,10,${alpha})` : `rgba(10,10,10,${alpha})`;
        ctx.lineWidth = lerp(0.5, 1.15, depth);
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      };
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i, a = nodes[k];
          if (i + 1 < cols) edge(a, nodes[k + 1], k, k + 1);
          if (j + 1 < rows) edge(a, nodes[k + cols], k, k + cols);
          // Alternate the diagonals so every quad becomes two triangles.
          if (i + 1 < cols && j + 1 < rows) {
            if ((i + j) % 2 === 0) edge(a, nodes[k + cols + 1], k, k + cols + 1);
            else edge(nodes[k + 1], nodes[k + cols], k + 1, k + cols);
          }
        }
      }

      for (let k = 0; k < nodes.length; k++) {
        const n = nodes[k];
        if (n.sx < -20 || n.sx > w + 20 || n.sy < -20 || n.sy > h + 20) continue;
        const r = lerp(0.9, 2.8, n.depth);
        const swept = sweep >= 0 && Math.abs(n.u - sweep) < 0.035;
        const isT = flare > 0 && k === tamper;
        // Depth of field: the nearest and farthest nodes soften into bokeh.
        const blur = n.depth > 0.86 ? (n.depth - 0.86) / 0.14 : n.depth < 0.12 ? (0.12 - n.depth) / 0.12 : 0;
        if (n.crest > 0.3 || swept || isT) {
          const glow = isT ? flare : Math.max(n.crest, swept ? 0.9 : 0);
          const g = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, r * 5);
          g.addColorStop(0, isT ? `rgba(215,38,61,${0.45 * glow})` : `rgba(217,180,74,${0.42 * glow})`);
          g.addColorStop(1, isT ? "rgba(215,38,61,0)" : "rgba(217,180,74,0)");
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(n.sx, n.sy, r * 5, 0, Math.PI * 2); ctx.fill();
        }
        const ink = isT ? "215,38,61" : n.crest > 0.3 || swept ? "184,137,10" : "10,10,10";
        if (blur > 0) {
          ctx.fillStyle = `rgba(${ink},${0.12 * (1 - blur * 0.5)})`;
          ctx.beginPath(); ctx.arc(n.sx, n.sy, r * (1.6 + blur * 2.2), 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = `rgba(${ink},${lerp(0.25, 0.9, n.depth)})`;
          ctx.beginPath(); ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (visible && !reduce) raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) { resize(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
    });
    const onMove = (e: PointerEvent) => { const b = c.getBoundingClientRect(); pointer.x = e.clientX - b.left; pointer.y = e.clientY - b.top; };
    const onLeave = () => { pointer.x = -1e4; pointer.y = -1e4; };
    resize();
    io.observe(c);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); io.disconnect();
      window.removeEventListener("resize", resize); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}
