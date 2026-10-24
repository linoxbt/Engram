"use client";
import clsx from "clsx";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type RefObject, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { IconCopy, IconCross, IconTick } from "./icons";
import { shortHash } from "@/lib/format";

export { clsx as cx };

type Variant = "primary" | "ghost" | "danger" | "gold" | "outline";
export function Button({ variant = "outline", size = "md", loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-[2px] border font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "border-accent bg-accent text-bg hover:bg-accent/85",
        variant === "outline" && "border-line-2 bg-panel text-text hover:border-accent hover:text-accent",
        variant === "ghost" && "border-transparent text-muted hover:text-text hover:bg-panel-2",
        variant === "danger" && "border-tamper/60 text-tamper hover:bg-tamper/10",
        variant === "gold" && "border-gold/70 text-gold hover:bg-gold/10",
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx("inline-block size-3 animate-spin rounded-full border border-current border-t-transparent", className)} aria-hidden />;
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={clsx("h-9 w-full rounded-[2px] border border-line-2 bg-bg px-3 text-sm text-text placeholder:text-muted/70 focus:border-accent focus:outline-none", className)} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={clsx("w-full rounded-[2px] border border-line-2 bg-bg px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:border-accent focus:outline-none", className)} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={clsx("h-9 rounded-[2px] border border-line-2 bg-bg px-2 text-sm text-text focus:border-accent focus:outline-none", className)}>{children}</select>;
}

export function Field({ label, help, children, htmlFor }: { label: string; help?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block space-y-1.5" htmlFor={htmlFor}>
      <span className="label block">{label}</span>
      {children}
      {help && <span className="block text-2xs text-muted">{help}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={clsx("relative h-5 w-9 rounded-full border transition-colors disabled:opacity-50", checked ? "border-accent bg-accent/25" : "border-line-2 bg-bg")}>
      <span className={clsx("absolute top-0.5 size-3.5 rounded-full transition-all", checked ? "left-[18px] bg-accent" : "left-0.5 bg-muted")} />
    </button>
  );
}

const PILL: Record<string, string> = {
  active: "border-valid/40 text-valid", valid: "border-valid/40 text-valid",
  superseded: "border-muted/40 text-muted", forgotten: "border-line-2 text-muted border-dashed",
  recorded: "border-line-2 text-muted", conflict: "border-tamper/50 text-tamper", tampered: "border-tamper/60 text-tamper",
  warning: "border-warn/50 text-warn", pending: "border-warn/50 text-warn", gold: "border-gold/50 text-gold",
  accent: "border-accent/50 text-accent", violet: "border-violet/50 text-violet",
};
export function Pill({ tone, children, className }: { tone: keyof typeof PILL | string; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[2px] border px-1.5 text-2xs uppercase tracking-wider", PILL[tone] ?? "border-line-2 text-muted", className)}>{children}</span>;
}

export function Card({ children, className, state, title, action }: { children: ReactNode; className?: string; state?: "tampered" | "sealed" | "valid" | "warning"; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={clsx("card", className)} data-state={state}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="label">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-[2px] bg-panel-2", className)} />;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="grid-bg size-12 rounded-[2px] border border-line opacity-60" />
      <p className="text-sm text-text">{title}</p>
      {children && <div className="max-w-md text-xs text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="rounded-[2px] border border-tamper/40 bg-tamper/5 px-3 py-2 text-xs text-tamper">{error instanceof Error ? error.message : String(error)}</p>;
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={`${label}: ${value.slice(0, 40)}`} title={label}
      onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* clipboard blocked */ } }}
      className={clsx("inline-flex size-6 items-center justify-center rounded-[2px] text-muted hover:bg-panel-2 hover:text-accent", className)}>
      {done ? <IconTick className="text-valid" /> : <IconCopy />}
    </button>
  );
}

export function Hash({ value, full = false, className }: { value: string | null | undefined; full?: boolean; className?: string }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span className={clsx("inline-flex items-center gap-1 tabular", className)}>
      <code className="break-all text-xs" title={value}>{full ? value : shortHash(value)}</code>
      <CopyButton value={value} label="Copy hash" />
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={clsx("-mb-px shrink-0 border-b-2 px-3 py-2 text-xs uppercase tracking-wider", value === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-text")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

type Layer = { close: () => void; el: () => HTMLElement | null; trap: boolean };
const layers: Layer[] = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled])';
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

function onLayerKey(e: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (!top || e.defaultPrevented || e.isComposing) return;
  if (e.key === "Escape") { e.preventDefault(); top.close(); return; }
  const root = top.el();
  if (e.key !== "Tab" || !top.trap || !root) return;
  const els = focusables(root);
  const active = document.activeElement;
  if (!els.length) { e.preventDefault(); root.focus(); return; }
  const first = els[0], last = els[els.length - 1];
  if (!root.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

/**
 * One stack of open overlays: only the topmost handles Escape (and traps Tab when `trap`). Focus moves in once on
 * open (`field`: first form field, else the layer; `first`: first focusable; `self`: the layer) and returns on close.
 */
export function useLayer(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>, { trap = true, focus = "field" }: { trap?: boolean; focus?: "field" | "first" | "self" } = {}) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer: Layer = { close: () => close.current(), el: () => ref.current, trap };
    layers.push(layer);
    if (layers.length === 1) window.addEventListener("keydown", onLayerKey);
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      const target = focus === "self" ? root : focus === "first" ? focusables(root)[0] : root.querySelector<HTMLElement>(FIELD);
      (target ?? root).focus({ preventScroll: true });
    }
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (!layers.length) window.removeEventListener("keydown", onLayerKey);
      const active = document.activeElement;
      if (prev?.isConnected && (!active || active === document.body || root?.contains(active))) prev.focus({ preventScroll: true });
    };
  }, [open, ref, trap, focus]);
}

/** Overlays render into <body>, out of any transformed or stacking ancestor (a Modal opened from a Drawer). */
const portal = (node: ReactNode) => (typeof document === "undefined" ? node : createPortal(node, document.body));

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(open, onClose, ref);
  if (!open) return null;
  return portal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6 anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={clsx("card max-h-[90vh] w-full overflow-auto focus:outline-none", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="label">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-text"><IconCross /></button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** Right-side drawer on desktop, bottom sheet below 900px. Escape closes. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useLayer(open, onClose, ref, { focus: "self" });
  if (!open) return null;
  return portal(
    <div className="fixed inset-0 z-40 bg-black/50 anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} role="dialog" aria-modal="true" tabIndex={-1} className="absolute bottom-0 right-0 flex max-h-[88vh] w-full flex-col border-t border-line bg-panel focus:outline-none min-[900px]:top-0 min-[900px]:max-h-none min-[900px]:w-[560px] min-[900px]:border-l min-[900px]:border-t-0 anim-slide-in">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">{title}</div>
          <button onClick={onClose} aria-label="Close drawer" className="text-muted hover:text-text"><IconCross /></button>
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  );
}

interface Toast { id: number; text: string; tone: "info" | "ok" | "error" }
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[90] flex max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={clsx("panel anim-slide-in px-3 py-2 text-xs shadow-lg", t.tone === "ok" && "border-valid/50 text-valid", t.tone === "error" && "border-tamper/50 text-tamper")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "valid" | "warn" | "tamper" | "gold" | "muted"; hint?: string }) {
  return (
    <div className="panel px-3 py-2.5" title={hint}>
      <div className="label">{label}</div>
      <div className={clsx("mt-1 text-xl tabular", tone === "valid" && "text-valid", tone === "warn" && "text-warn", tone === "tamper" && "text-tamper", tone === "gold" && "text-gold", tone === "muted" && "text-muted")}>{value}</div>
    </div>
  );
}

export function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-lg tracking-wide">{title}</h1>
        {children && <p className="mt-1 max-w-3xl text-xs text-muted">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
