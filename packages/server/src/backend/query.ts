/** In-process evaluation of QuerySpec, used by the local backend and the filter fallback. */
import { cosine } from "@engram/core";
import type { Filter, QuerySpec, VDoc } from "./types";

export function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

const fieldOf = (doc: VDoc, path: string) => (path.startsWith("$") ? (doc as any)[path] : getPath(doc, path));

export function matches(doc: VDoc, f: Filter): boolean {
  const v = fieldOf(doc, f.path);
  switch (f.op) {
    case "eq": return f.values.some((x) => (x === null ? v == null : Array.isArray(v) ? v.includes(x) : v === x));
    case "ne": return f.value === null ? v != null : v !== f.value;
    case "lt": return typeof v === "string" && v < f.value;
    case "lte": return typeof v === "string" && v <= f.value;
    case "gt": return typeof v === "string" && v > f.value;
    case "gte": return typeof v === "string" && v >= f.value;
    case "isNull": return v == null;
    case "isNotNull": return v != null;
    case "contains":
      if (Array.isArray(v)) return v.includes(f.value);
      return typeof v === "string" && v.toLowerCase().includes(f.value.toLowerCase());
    case "startsWith": return typeof v === "string" && v.startsWith(f.value);
  }
}

export function evaluate<M>(all: VDoc<M>[], q: QuerySpec): VDoc<M>[] {
  let rows = all.filter((d) => (q.filters ?? []).every((f) => matches(d, f)));
  if (q.vector) {
    const qv = q.vector;
    rows = rows
      .filter((d) => d.embeddings)
      .map((d) => ({ ...d, $distance: 1 - cosine(qv, d.embeddings!) }))
      .sort((a, b) => a.$distance! - b.$distance!);
  } else if (q.order) {
    const { field, dir } = q.order;
    rows = [...rows].sort((a, b) => {
      const x = String((a as any)[field] ?? ""), y = String((b as any)[field] ?? "");
      return dir === "asc" ? (x < y ? -1 : x > y ? 1 : 0) : (x > y ? -1 : x < y ? 1 : 0);
    });
  }
  if (q.cursorAfter) {
    const i = rows.findIndex((d) => d.$id === q.cursorAfter);
    rows = i >= 0 ? rows.slice(i + 1) : rows;
  }
  rows = rows.slice(0, q.limit ?? 25);
  return q.withVectors === false ? rows.map(({ embeddings: _e, ...rest }) => rest as VDoc<M>) : rows;
}
