import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 14, ...p }: P) => ({ width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });

export const IconTick = (p: P) => <svg {...base(p)}><path d="M3 8.5l3 3 7-7" /></svg>;
export const IconCross = (p: P) => <svg {...base(p)}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const IconSeal = (p: P) => <svg {...base(p)}><circle cx="8" cy="7" r="4.5" /><path d="M5.5 10.5L4.5 15 8 13l3.5 2-1-4.5" /></svg>;
export const IconBlock = (p: P) => <svg {...base(p)}><rect x="2.5" y="4" width="11" height="8" rx="1" /><path d="M5 8h6" /></svg>;
export const IconForget = (p: P) => <svg {...base(p)}><rect x="2.5" y="4" width="11" height="8" rx="1" strokeDasharray="2 2" /></svg>;
export const IconLink = (p: P) => <svg {...base(p)}><path d="M6.5 9.5l3-3M5 11a2.5 2.5 0 010-3.5l1.5-1.5M11 5a2.5 2.5 0 010 3.5L9.5 10" /></svg>;
export const IconReflect = (p: P) => <svg {...base(p)}><path d="M8 2l1.6 3.9L13.5 6l-3 2.6.9 4L8 10.5 4.6 12.6l.9-4L2.5 6l3.9-.1z" /></svg>;
export const IconSearch = (p: P) => <svg {...base(p)}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>;
export const IconClock = (p: P) => <svg {...base(p)}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>;
export const IconShield = (p: P) => <svg {...base(p)}><path d="M8 1.8l5 2v4c0 3.2-2.2 5.4-5 6.4-2.8-1-5-3.2-5-6.4v-4z" /></svg>;
export const IconAlert = (p: P) => <svg {...base(p)}><path d="M8 2l6.5 11.5h-13z" /><path d="M8 6.5v3M8 11.5v.2" /></svg>;
export const IconCopy = (p: P) => <svg {...base(p)}><rect x="5" y="5" width="8.5" height="8.5" rx="1" /><path d="M3 10.5V3.5a1 1 0 011-1h6.5" /></svg>;
export const IconChain = (p: P) => <svg {...base(p)}><rect x="1.5" y="5.5" width="5" height="5" rx="1" /><rect x="9.5" y="5.5" width="5" height="5" rx="1" /><path d="M6.5 8h3" /></svg>;
export const IconAgents = (p: P) => <svg {...base(p)}><circle cx="6" cy="6" r="2.5" /><path d="M1.8 13.5c.6-2.3 2.2-3.5 4.2-3.5s3.6 1.2 4.2 3.5" /><path d="M10.5 3.8a2.3 2.3 0 010 4.4M12.5 10.3c.9.5 1.5 1.6 1.8 3.2" /></svg>;
export const IconGraph = (p: P) => <svg {...base(p)}><circle cx="4" cy="4" r="1.8" /><circle cx="12" cy="5" r="1.8" /><circle cx="7" cy="12" r="1.8" /><path d="M5.6 4.3l4.6.5M5 5.5l1.4 4.8M10.8 6.4l-2.8 4.2" /></svg>;
export const IconInbox = (p: P) => <svg {...base(p)}><path d="M2 9l2-6h8l2 6v4H2z" /><path d="M2 9h3.5l1 1.5h3l1-1.5H14" /></svg>;
export const IconHome = (p: P) => <svg {...base(p)}><path d="M2.5 7.5L8 3l5.5 4.5V13h-4V9.5h-3V13h-4z" /></svg>;
export const IconList = (p: P) => <svg {...base(p)}><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1" /></svg>;
export const IconLab = (p: P) => <svg {...base(p)}><path d="M6 2h4M6.5 2v4L2.8 12.5A1 1 0 003.7 14h8.6a1 1 0 00.9-1.5L9.5 6V2" /><path d="M4.5 10h7" /></svg>;
export const IconSettings = (p: P) => <svg {...base(p)}><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></svg>;
export const IconAudit = (p: P) => <svg {...base(p)}><path d="M4 2h6l3 3v9H4z" /><path d="M10 2v3h3M6 8h5M6 11h3" /></svg>;
export const IconPlus = (p: P) => <svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>;
export const IconArrow = (p: P) => <svg {...base(p)}><path d="M3 8h10M9 4l4 4-4 4" /></svg>;
export const IconExternal = (p: P) => <svg {...base(p)}><path d="M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5" /></svg>;
export const IconMenu = (p: P) => <svg {...base(p)}><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>;
export const IconBolt = (p: P) => <svg {...base(p)}><path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" /></svg>;
export const IconKey = (p: P) => <svg {...base(p)}><circle cx="5" cy="10.5" r="3" /><path d="M7.2 8.4L13.5 2M11 4.5l1.8 1.8M9.5 6l1.3 1.3" /></svg>;
export const IconGrid = (p: P) => <svg {...base(p)}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></svg>;
export const IconPulse = (p: P) => <svg {...base(p)}><path d="M1.5 8.5h3l1.8-4 3 7.5 1.9-3.5h3.3" /></svg>;
export const IconUser = (p: P) => <svg {...base(p)}><circle cx="8" cy="5.5" r="3" /><path d="M2.5 14c.8-2.8 2.9-4.2 5.5-4.2s4.7 1.4 5.5 4.2" /></svg>;
export const IconBook = (p: P) => <svg {...base(p)}><path d="M2.5 3.5c2-.8 3.8-.6 5.5.7 1.7-1.3 3.5-1.5 5.5-.7v9c-2-.8-3.8-.6-5.5.7-1.7-1.3-3.5-1.5-5.5-.7z" /><path d="M8 4.2v9" /></svg>;
export const IconPlug = (p: P) => <svg {...base(p)}><path d="M6 1.8v3M10 1.8v3M4 4.8h8v2.7a4 4 0 01-8 0z" /><path d="M8 11.5v2.7" /></svg>;
export const IconSidebar = (p: P) => <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6 2.5v11" /></svg>;
export const IconChevron = (p: P) => <svg {...base(p)}><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>;

/**
 * The Engram mark: an E drawn as three entries on one spine (the hash chain). The middle entry
 * ends in a gold seal, the signed head. Black tile, so it reads the same at 16px as in a header.
 */
export const IconLogo = ({ size = 22, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <rect width="24" height="24" rx="6.5" fill="#0a0a0a" />
    <path d="M8.25 6.75v10.5M8.25 6.75h8M8.25 12h4.75M8.25 17.25h8" stroke="#ffffff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="16.6" cy="12" r="1.85" fill="#d9b44a" />
  </svg>
);

/** Mark plus wordmark, used in headers. */
export function Wordmark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <IconLogo size={size} />
      <span className={`font-sans font-semibold tracking-[-0.02em] text-text ${size >= 22 ? "text-[17px]" : "text-[15px]"}`}>engram</span>
    </span>
  );
}

export function OpIcon({ op, ...p }: P & { op: string }) {
  if (op === "forget") return <IconForget {...p} />;
  if (op === "link") return <IconLink {...p} />;
  if (op === "reflect") return <IconReflect {...p} />;
  return <IconBlock {...p} />;
}
