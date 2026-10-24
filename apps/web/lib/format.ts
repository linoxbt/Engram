export const shortHash = (h: string | null | undefined, a = 6, b = 4) => (h ? `${h.slice(0, a)}…${h.slice(-b)}` : "—");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "27 Oct 11:05" in UTC: the demo story and chain timestamps are UTC. */
export function when(iso: string | null | undefined, opts: { year?: boolean; seconds?: boolean } = {}) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const t = iso.slice(11, opts.seconds ? 19 : 16);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${opts.year ? ` ${d.getUTCFullYear()}` : ""} ${t}`;
}
export function day(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86_400 * 30) return `${Math.round(s / 86_400)}d ago`;
  return day(iso);
}
export const seqOfId = (id: string) => Number(id.slice(-12));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
