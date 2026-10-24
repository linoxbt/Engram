"use client";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconCross, IconSeal, IconTick } from "./icons";
import { shortHash } from "@/lib/format";

export interface StripBlock { seq: number; op: string; status?: string; hash?: string; text?: string | null; agentName?: string }
export type BlockState = "ok" | "fail" | "pending";

const W = 22, GAP = 5, STEP = W + GAP;

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/**
 * The chain strip: one block per entry, coloured by op, checkpoints as gold
 * flags. Virtualised so 2,000+ blocks scroll smoothly; a keyboard listbox
 * (arrow keys move, Enter opens). Becomes a vertical list below 900px.
 */
export function ChainStrip({
  blocks, checkpoints = [], states, focusSeq, onOpen, label = "Chain", compact = false, newestFirstOnMobile = true,
}: {
  blocks: StripBlock[];
  /** Sizes of signed checkpoints: a flag sits above entry size-1. */
  checkpoints?: number[];
  states?: Map<number, BlockState>;
  focusSeq?: number | null;
  onOpen?: (seq: number) => void;
  label?: string;
  compact?: boolean;
  newestFirstOnMobile?: boolean;
}) {
  const narrow = useNarrow();
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [width, setWidth] = useState(800);
  const [active, setActive] = useState<number | null>(null);
  const [hover, setHover] = useState<{ b: StripBlock; x: number } | null>(null);
  const flags = useMemo(() => new Set(checkpoints.map((s) => s - 1)), [checkpoints]);
  const index = useMemo(() => new Map(blocks.map((b, i) => [b.seq, i])), [blocks]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [narrow]);

  // Keep the newest blocks in view as the chain grows.
  const lastLen = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || narrow) return;
    if (blocks.length > lastLen.current && (lastLen.current === 0 || el.scrollLeft + el.clientWidth >= lastLen.current * STEP - STEP * 2)) {
      el.scrollLeft = el.scrollWidth;
    }
    lastLen.current = blocks.length;
  }, [blocks.length, narrow]);

  const scrollTo = useCallback((seq: number) => {
    const el = ref.current;
    const i = index.get(seq);
    if (!el || i == null) return;
    if (narrow) {
      el.querySelector<HTMLElement>(`[data-seq="${seq}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      const x = i * STEP;
      if (x < el.scrollLeft + STEP || x > el.scrollLeft + el.clientWidth - STEP * 2) el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: "smooth" });
    }
  }, [index, narrow]);

  useEffect(() => { if (focusSeq != null) { setActive(focusSeq); scrollTo(focusSeq); } }, [focusSeq, scrollTo]);

  const onKey = (e: KeyboardEvent) => {
    if (!blocks.length) return;
    const cur = active ?? blocks[blocks.length - 1].seq;
    const i = index.get(cur) ?? blocks.length - 1;
    const prevKey = narrow ? "ArrowUp" : "ArrowLeft", nextKey = narrow ? "ArrowDown" : "ArrowRight";
    let ni = i;
    if (e.key === prevKey) ni = Math.max(0, i - 1);
    else if (e.key === nextKey) ni = Math.min(blocks.length - 1, i + 1);
    else if (e.key === "Home") ni = 0;
    else if (e.key === "End") ni = blocks.length - 1;
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(cur); return; }
    else return;
    e.preventDefault();
    const seq = blocks[ni].seq;
    setActive(seq);
    scrollTo(seq);
  };

  if (narrow) {
    const list = newestFirstOnMobile ? [...blocks].reverse() : blocks;
    return (
      <div ref={ref} role="listbox" aria-label={label} tabIndex={0} onKeyDown={onKey} aria-activedescendant={active != null ? `blk-${active}` : undefined}
        className={clsx("overflow-y-auto rounded-[2px] border border-line bg-bg", compact ? "max-h-56" : "max-h-[60vh]")}>
        {list.map((b) => (
          <button key={b.seq} id={`blk-${b.seq}`} data-seq={b.seq} role="option" aria-selected={active === b.seq} onClick={() => onOpen?.(b.seq)}
            className={clsx("flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-xs", active === b.seq && "bg-panel-2")}>
            <Block b={b} state={states?.get(b.seq)} flag={flags.has(b.seq)} small />
            <span className="w-12 shrink-0 tabular text-muted">#{b.seq}</span>
            <span className="truncate">{b.text === undefined ? <span className="text-muted">{b.op} · {shortHash(b.hash)}</span> : b.op === "forget" ? "forget entry" : b.op === "link" ? "link entry" : b.text ?? "content erased"}</span>
          </button>
        ))}
      </div>
    );
  }

  const first = Math.max(0, Math.floor(scroll / STEP) - 10);
  const last = Math.min(blocks.length, Math.ceil((scroll + width) / STEP) + 10);
  const visible = blocks.slice(first, last);
  const h = compact ? 46 : 64;

  return (
    <div className="relative">
      <div ref={ref} role="listbox" aria-label={label} tabIndex={0} onKeyDown={onKey} onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
        aria-activedescendant={active != null ? `blk-${active}` : undefined}
        className="relative overflow-x-auto overflow-y-hidden rounded-[2px] border border-line bg-bg" style={{ height: h + 18 }}>
        <div className="relative" style={{ width: Math.max(blocks.length * STEP + 16, width), height: h }}>
          {visible.map((b, k) => {
            const i = first + k;
            return (
              <div key={b.seq} id={`blk-${b.seq}`} role="option" aria-selected={active === b.seq} aria-label={`Entry ${b.seq}, ${b.op}${states?.get(b.seq) === "fail" ? ", failed verification" : states?.get(b.seq) === "ok" ? ", verified" : ""}`}
                className="absolute" style={{ left: 8 + i * STEP, top: compact ? 14 : 22 }}
                onMouseEnter={(e) => setHover({ b, x: (e.currentTarget as HTMLElement).offsetLeft - scroll })} onMouseLeave={() => setHover(null)}>
                {i > 0 && <span className={clsx("absolute top-1/2 h-px", states?.get(b.seq) === "fail" ? "bg-tamper" : "bg-line-2")} style={{ left: -GAP, width: GAP }} />}
                <button tabIndex={-1} onClick={() => { setActive(b.seq); onOpen?.(b.seq); }} className={clsx("block", active === b.seq && "outline outline-2 outline-offset-2 outline-cyan")}>
                  <Block b={b} state={states?.get(b.seq)} flag={flags.has(b.seq)} />
                </button>
                {(i % 10 === 0 || i === blocks.length - 1) && !compact && <span className="absolute left-0 top-[34px] text-[10px] tabular text-muted">{b.seq}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {hover && (
        <div className="pointer-events-none absolute -top-2 z-20 w-64 -translate-y-full rounded-[2px] border border-line-2 bg-panel-2 px-2.5 py-2 text-2xs shadow-lg" style={{ left: Math.min(Math.max(0, hover.x - 100), width - 260) }}>
          <div className="flex justify-between"><span className="text-cyan">#{hover.b.seq} · {hover.b.op}</span><span className="text-muted">{shortHash(hover.b.hash)}</span></div>
          <div className="mt-1 line-clamp-2 text-text">{hover.b.text === undefined ? "Header only: text is never shared publicly." : hover.b.op === "forget" ? "Forget entry" : hover.b.op === "link" ? "Link entry (resolution)" : hover.b.text ?? "Content erased. Receipt kept."}</div>
          {hover.b.agentName && <div className="mt-0.5 text-muted">{hover.b.agentName}</div>}
        </div>
      )}
    </div>
  );
}

function Block({ b, state, flag, small }: { b: StripBlock; state?: BlockState; flag: boolean; small?: boolean }) {
  const size = small ? "h-4 w-3" : "h-[22px] w-[22px]";
  const base =
    b.op === "forget" ? "border border-dashed border-muted/70 bg-transparent" :
    b.op === "link" ? "border border-line-2 bg-transparent" :
    b.op === "reflect" ? "border-2 border-violet/80 bg-violet/10" :
    b.status === "superseded" ? "border-2 border-cyan/40 bg-transparent" :
    b.status === "forgotten" ? "border border-dashed border-cyan/50 bg-transparent" :
    "border-2 border-cyan/90 bg-cyan/10";
  return (
    <span className={clsx("relative inline-flex shrink-0 items-center justify-center rounded-[2px] transition-colors", size, base,
      state === "ok" && "border-valid! bg-valid/20!", state === "fail" && "border-tamper! bg-tamper/30! anim-flash")}>
      {state === "ok" && !small && <IconTick size={11} className="text-valid" />}
      {state === "fail" && !small && <IconCross size={11} className="text-tamper" />}
      {flag && (
        <span className={clsx("absolute left-1/2 -translate-x-1/2 text-gold", small ? "-top-3" : "-top-[18px] anim-stamp")} title="Signed checkpoint">
          <IconSeal size={small ? 10 : 13} />
        </span>
      )}
    </span>
  );
}
