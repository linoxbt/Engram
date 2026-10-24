"use client";
import { useEffect, useRef } from "react";

interface Node3 { x: number; y: number; z: number; seal: boolean }

/**
 * The hero: a slowly turning double helix of memory blocks linked by hash
 * threads, drifting in a field of dust. Every few seconds one block is
 * "edited": it flares red and the links after it snap, then a gold seal
 * pulses at the head and the chain heals. Pauses offscreen; static under
 * reduced motion.
 */
export function Lattice({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const N = 46;
    const nodes: Node3[] = Array.from({ length: N }, (_, i) => {
      const t = i / (N - 1);
      const a = t * Math.PI * 7;
      const strand = i % 2 ? Math.PI : 0;
      return { x: Math.cos(a + strand) * 1.05, y: (t - 0.5) * 4.6, z: Math.sin(a + strand) * 1.05, seal: i % 8 === 7 };
    });
    const dust = Array.from({ length: 220 }, () => ({ x: (Math.random() - 0.5) * 9, y: (Math.random() - 0.5) * 7, z: (Math.random() - 0.5) * 6, s: Math.random() }));
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, mx = 0, my = 0;
    let tamper = -1, tamperAt = 0;
    const start = performance.now();

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const project = (p: { x: number; y: number; z: number }, rot: number, tilt: number) => {
      const cr = Math.cos(rot), sr = Math.sin(rot);
      let x = p.x * cr - p.z * sr, z = p.x * sr + p.z * cr;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const y = p.y * ct - z * st; z = p.y * st + z * ct;
      // Lay the helix diagonally across the hero.
      const ang = -0.95, xx = x * Math.cos(ang) - y * Math.sin(ang), yy = x * Math.sin(ang) + y * Math.cos(ang);
      const f = 3.4 / (3.4 + z + 1.6);
      // On narrow screens the helix sits low in the hero, clear of the copy.
      const narrow = w < 768;
      const scale = Math.min(w, h * 1.4) * (narrow ? 0.13 : 0.17);
      return { sx: w * (narrow ? 0.62 : 0.66) + xx * scale * f, sy: h * (narrow ? 0.86 : 0.5) + yy * scale * f, f, z };
    };

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      if (!reduce && t - tamperAt > 6.5) { tamper = 6 + Math.floor(Math.random() * (N - 14)); tamperAt = t; }
      const phase = t - tamperAt;
      const broken = tamper >= 0 && phase < 2.6;
      const sealPulse = tamper >= 0 && phase > 2.6 && phase < 4.2 ? (phase - 2.6) / 1.6 : -1;
      const rot = reduce ? 0.6 : t * 0.12 + mx * 0.25;
      const tilt = 0.28 + my * 0.12;
      ctx.clearRect(0, 0, w, h);

      for (const d of dust) {
        const p = project({ x: d.x, y: d.y + Math.sin(t * 0.2 + d.s * 6) * 0.05, z: d.z }, rot * 0.4, tilt);
        ctx.fillStyle = `rgba(${d.s > 0.8 ? "217,180,74" : d.s > 0.5 ? "155,140,255" : "159,243,250"},${0.08 + 0.25 * p.f * d.s})`;
        ctx.fillRect(p.sx, p.sy, 1.2 * p.f, 1.2 * p.f);
      }
      const P = nodes.map((n) => project(n, rot, tilt));
      for (let i = 1; i < N; i++) {
        const a = P[i - 1], b = P[i];
        const bad = broken && i > tamper;
        const snap = broken && i === tamper + 1;
        ctx.strokeStyle = bad ? `rgba(255,93,115,${snap ? 0.15 : 0.35})` : `rgba(0,194,209,${0.12 + 0.3 * ((a.f + b.f) / 2 - 0.6)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (snap) { ctx.moveTo(a.sx, a.sy); ctx.lineTo((a.sx + b.sx) / 2 - 4, (a.sy + b.sy) / 2 - 4); }
        else { ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
        ctx.stroke();
      }
      // Rungs between strands: the Merkle pairing.
      for (let i = 0; i + 1 < N; i += 2) {
        const a = P[i], b = P[i + 1];
        ctx.strokeStyle = "rgba(155,140,255,0.08)";
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
      const order = P.map((p, i) => ({ p, i })).sort((u, v) => v.p.z - u.p.z);
      for (const { p, i } of order) {
        const size = 7 * p.f;
        const isT = broken && i === tamper;
        const after = broken && i > tamper;
        ctx.save();
        ctx.translate(p.sx, p.sy);
        if (isT) { ctx.shadowColor = "rgba(255,93,115,.9)"; ctx.shadowBlur = 24; }
        else if (nodes[i].seal) { ctx.shadowColor = "rgba(217,180,74,.7)"; ctx.shadowBlur = 14; }
        else { ctx.shadowColor = "rgba(0,194,209,.6)"; ctx.shadowBlur = 10 * p.f; }
        ctx.strokeStyle = isT ? "#ff5d73" : after ? "rgba(255,93,115,.55)" : nodes[i].seal ? "#d9b44a" : `rgba(159,243,250,${0.45 + 0.5 * (p.f - 0.6)})`;
        ctx.fillStyle = isT ? "rgba(255,93,115,.35)" : nodes[i].seal ? "rgba(217,180,74,.18)" : "rgba(0,194,209,.10)";
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.roundRect(-size / 2, -size * 0.7, size, size * 1.4, 1.5); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      if (sealPulse >= 0) {
        const head = P[N - 1];
        ctx.strokeStyle = `rgba(217,180,74,${0.8 * (1 - sealPulse)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(head.sx, head.sy, 10 + sealPulse * 60, 0, Math.PI * 2); ctx.stroke();
      }
      if (visible && !reduce) raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } });
    const onMove = (e: PointerEvent) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; };
    resize();
    io.observe(c);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener("resize", resize); window.removeEventListener("pointermove", onMove); };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}
