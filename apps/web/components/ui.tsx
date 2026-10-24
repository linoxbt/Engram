"use client";
import clsx from "clsx";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
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
        variant === "primary" && "border-cyan bg-cyan text-bg hover:bg-cyan/85",
        variant === "outline" && "border-line-2 bg-panel text-text hover:border-cyan hover:text-cyan",
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
  return <input {...p} className={clsx("h-9 w-full rounded-[2px] border border-line-2 bg-bg px-3 text-sm text-text placeholder:text-muted/70 focus:border-cyan focus:outline-none", className)} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={clsx("w-full rounded-[2px] border border-line-2 bg-bg px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:border-cyan focus:outline-none", className)} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={clsx("h-9 rounded-[2px] border border-line-2 bg-bg px-2 text-sm text-text focus:border-cyan focus:outline-none", className)}>{children}</select>;
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
      className={clsx("relative h-5 w-9 rounded-full border transition-colors disabled:opacity-50", checked ? "border-cyan bg-cyan/25" : "border-line-2 bg-bg")}>
      <span className={clsx("absolute top-0.5 size-3.5 rounded-full transition-all", checked ? "left-[18px] bg-cyan" : "left-0.5 bg-muted")} />
    </button>
  );
}

const PILL: Record<string, string> = {
  active: "border-valid/40 text-valid", valid: "border-valid/40 text-valid",
  superseded: "border-muted/40 text-muted", forgotten: "border-line-2 text-muted border-dashed",
  recorded: "border-line-2 text-muted", conflict: "border-tamper/50 text-tamper", tampered: "border-tamper/60 text-tamper",
  warning: "border-warn/50 text-warn", pending: "border-warn/50 text-warn", gold: "border-gold/50 text-gold",
  cyan: "border-cyan/50 text-cyan", violet: "border-violet/50 text-violet",
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
      className={clsx("inline-flex size-6 items-center justify-center rounded-[2px] text-muted hover:bg-panel-2 hover:text-cyan", className)}>
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
          className={clsx("-mb-px shrink-0 border-b-2 px-3 py-2 text-xs uppercase tracking-wider", value === t.id ? "border-cyan text-cyan" : "border-transparent text-muted hover:text-text")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,textarea,button,select")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6 anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={clsx("card max-h-[90vh] w-full overflow-auto", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/50 anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" className="absolute bottom-0 right-0 flex max-h-[88vh] w-full flex-col border-t border-line bg-panel min-[900px]:top-0 min-[900px]:max-h-none min-[900px]:w-[560px] min-[900px]:border-l min-[900px]:border-t-0 anim-slide-in">
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
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2">
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

export function useStableId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}
