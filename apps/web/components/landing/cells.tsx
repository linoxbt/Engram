"use client";
import { useEffect, useRef } from "react";

interface Cell { x: number; y: number; vx: number; vy: number; r: number; ph: number; seal: boolean }

/**
 * The hero: memories as living cells. Each drifts and breathes like tissue under a microscope while
 * hash threads hold them in chain order. A pulse runs down the chain to the newest cell, which seals
 * gold; every few seconds one cell is "edited", turns red, and the threads after it break until the
 * seal heals them. Cells shy away from the pointer. Pauses offscreen; static under reduced motion.
 */
export function CellField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true;
    let cells: Cell[] = [];
    const pointer = { x: -1e4, y: -1e4 };
    const start = performance.now();
    let tamper = -1, tamperAt = -10;

    const seed = () => {
      const n = Math.round(Math.min(30, Math.max(16, (w * h) / 14000)));
      // Narrow screens get fewer, larger cells so the stage reads as tissue, not specks.
      const base = Math.min(w, h) / (w < 600 ? 9.5 : 14);
      const cols = Math.max(3, Math.round(Math.sqrt((n * w) / h)));
      const rows = Math.ceil(n / cols);
      cells = Array.from({ length: n }, (_, i) => {
        // Serpentine order, so the chain winds through the field like a strand of tissue.
        const row = Math.floor(i / cols), col = row % 2 ? cols - 1 - (i % cols) : i % cols;
        return {
          x: ((col + 0.5) / cols) * w + (Math.random() - 0.5) * base * 1.8,
          y: ((row + 0.5) / rows) * h + (Math.random() - 0.5) * base * 1.8,
          vx: 0, vy: 0,
          r: base * (0.55 + Math.random() * 0.55),
          ph: Math.random() * Math.PI * 2,
          seal: i % 7 === 6,
        };
      });
    };
    const step = (t: number) => {
      const n = cells.length;
      for (let i = 0; i < n; i++) {
        const a = cells[i];
        let fx = Math.sin(t * 0.31 + a.ph) * 0.018 + Math.cos(t * 0.17 + a.ph * 2) * 0.012;
        let fy = Math.cos(t * 0.27 + a.ph) * 0.018 + Math.sin(t * 0.21 + a.ph * 3) * 0.012;
        // Chain neighbours hold together like a strand.
        for (const j of [i - 1, i + 1]) {
          if (j < 0 || j >= n) continue;
          const b = cells[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
          const rest = (a.r + b.r) * 1.45, k = (d - rest) * 0.0016;
          fx += (dx / d) * k; fy += (dy / d) * k;
        }
        // Membranes never overlap.
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const b = cells[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1, min = (a.r + b.r) * 1.12;
          if (d < min) { const k = (min - d) * 0.02; fx += (dx / d) * k; fy += (dy / d) * k; }
        }
        // A faint pull to the middle keeps the tissue filling its stage instead of drifting off.
        fx += (w / 2 - a.x) * 0.00008; fy += (h / 2 - a.y) * 0.00008;
        // Shy away from the pointer.
        const px = a.x - pointer.x, py = a.y - pointer.y, pd = Math.hypot(px, py);
        if (pd < 110) { const k = (110 - pd) * 0.006; fx += (px / (pd || 1)) * k; fy += (py / (pd || 1)) * k; }
        // Soft walls.
        const m = a.r + 6;
        if (a.x < m) fx += (m - a.x) * 0.01; if (a.x > w - m) fx -= (a.x - (w - m)) * 0.01;
        if (a.y < m) fy += (m - a.y) * 0.01; if (a.y > h - m) fy -= (a.y - (h - m)) * 0.01;
        a.vx = (a.vx + fx) * 0.93; a.vy = (a.vy + fy) * 0.93;
      }
      for (const a of cells) { a.x += a.vx; a.y += a.vy; }
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const nw = c.clientWidth, nh = c.clientHeight;
      if (!nw || !nh) return;
      const reseed = Math.abs(nw - w) > 40 || Math.abs(nh - h) > 40 || !cells.length;
      w = nw; h = nh;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reseed) {
        seed();
        // Let the tissue relax before the first frame, so it never starts as a grid.
        for (let k = 0; k < 180; k++) step(k / 60);
      }
    };

    const membrane = (a: Cell, t: number, scale = 1) => {
      ctx.beginPath();
      const steps = 28;
      for (let s = 0; s <= steps; s++) {
        const th = (s / steps) * Math.PI * 2;
        const rr = a.r * scale * (1 + 0.07 * Math.sin(3 * th + t * 1.1 + a.ph) + 0.045 * Math.sin(5 * th - t * 0.8 + a.ph * 2));
        const x = a.x + Math.cos(th) * rr, y = a.y + Math.sin(th) * rr;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      if (!reduce) step(t);
      const n = cells.length;
      if (!reduce && t - tamperAt > 8.5) { tamper = 3 + Math.floor(Math.random() * Math.max(1, n - 8)); tamperAt = t; }
      const phase = t - tamperAt;
      const broken = tamper >= 0 && phase < 2.4;
      const sealPulse = tamper >= 0 && phase > 2.4 && phase < 4 ? (phase - 2.4) / 1.6 : -1;
      const pulse = reduce ? -1 : ((t * 2.6) % (n + 6)) - 3; // travels tail -> head
      ctx.clearRect(0, 0, w, h);

      // Hash threads, edge to edge, gently curved.
      for (let i = 1; i < n; i++) {
        const a = cells[i - 1], b = cells[i];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        const x1 = a.x + ux * a.r, y1 = a.y + uy * a.r, x2 = b.x - ux * b.r, y2 = b.y - uy * b.r;
        const cx = (x1 + x2) / 2 - uy * d * 0.12, cy = (y1 + y2) / 2 + ux * d * 0.12;
        const bad = broken && i > tamper;
        ctx.strokeStyle = bad ? "rgba(215,38,61,.45)" : "rgba(10,10,10,.2)";
        ctx.lineWidth = 1.2;
        ctx.setLineDash(bad && i === tamper + 1 ? [3, 4] : []);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
        if (pulse > i - 1 && pulse < i && !bad) {
          const f = pulse - (i - 1), q = 1 - f;
          const px = q * q * x1 + 2 * q * f * cx + f * f * x2, py = q * q * y1 + 2 * q * f * cy + f * f * y2;
          ctx.fillStyle = "rgba(10,10,10,.75)";
          ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.setLineDash([]);

      // Cells: membrane, cytoplasm, nucleus.
      for (let i = 0; i < n; i++) {
        const a = cells[i];
        const isT = broken && i === tamper, after = broken && i > tamper, head = i === n - 1;
        const lit = pulse > i - 0.5 && pulse < i + 0.5;
        membrane(a, t);
        const g = ctx.createRadialGradient(a.x - a.r * 0.3, a.y - a.r * 0.35, a.r * 0.1, a.x, a.y, a.r * 1.1);
        g.addColorStop(0, "rgba(255,255,255,1)");
        // Opaque end tones: blending white into a transparent colour would pass through grey.
        g.addColorStop(1, isT ? "#fbe2e5" : a.seal ? "#f5edd6" : "#f1f1f1");
        ctx.fillStyle = g; ctx.fill();
        ctx.lineWidth = isT ? 1.8 : 1.3;
        ctx.strokeStyle = isT ? "#d7263d" : after ? "rgba(215,38,61,.55)" : lit ? "rgba(10,10,10,.8)" : "rgba(10,10,10,.36)";
        ctx.stroke();
        // Inner membrane gives the cell depth.
        membrane(a, t * 0.7 + 1, 0.62);
        ctx.strokeStyle = isT ? "rgba(215,38,61,.3)" : "rgba(10,10,10,.07)";
        ctx.lineWidth = 1; ctx.stroke();
        const nr = Math.max(2.4, a.r * 0.2) * (1 + 0.08 * Math.sin(t * 2 + a.ph));
        ctx.fillStyle = isT ? "#d7263d" : a.seal || (head && sealPulse >= 0) ? "#b8890a" : "rgba(10,10,10,.78)";
        ctx.beginPath(); ctx.arc(a.x + Math.sin(t * 0.6 + a.ph) * a.r * 0.12, a.y + Math.cos(t * 0.5 + a.ph) * a.r * 0.12, nr, 0, Math.PI * 2); ctx.fill();
      }

      if (sealPulse >= 0 && n) {
        const head = cells[n - 1];
        ctx.strokeStyle = `rgba(154,114,0,${0.75 * (1 - sealPulse)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(head.x, head.y, head.r * (1.1 + sealPulse * 2.2), 0, Math.PI * 2); ctx.stroke();
      }
      if (visible && !reduce) raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) { resize(); if (!reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } }
    });
    const onMove = (e: PointerEvent) => { const b = c.getBoundingClientRect(); pointer.x = e.clientX - b.left; pointer.y = e.clientY - b.top; };
    const onLeave = () => { pointer.x = -1e4; pointer.y = -1e4; };
    resize();
    io.observe(c);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    if (reduce) {
      // Let the layout settle, then draw one still frame.
      for (let k = 0; k < 240; k++) step(k / 60);
      frame(start);
    } else raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); io.disconnect();
      window.removeEventListener("resize", resize); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}
