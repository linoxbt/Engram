/**
 * VectorsDB requires an embeddings array on every document. Entries without
 * meaning (forget, link) and forgotten memories store this fixed unit vector.
 */
export function tombstoneVector(dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[0] = 1;
  return v;
}
export function isTombstone(v: number[] | undefined | null): boolean {
  if (!v || v.length === 0) return false;
  if (Math.abs(v[0] - 1) > 1e-6) return false;
  for (let i = 1; i < v.length; i++) if (Math.abs(v[i]) > 1e-6) return false;
  return true;
}
