/** Small PCA for the concept map: power iteration for the top two components. */
export function pca2(rows: number[][]): [number, number][] {
  const n = rows.length;
  if (!n) return [];
  const d = rows[0].length;
  const mean = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  const X = rows.map((r) => r.map((x, j) => x - mean[j]));
  const comps: number[][] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let c = 0; c < 2; c++) {
    let v = Array.from({ length: d }, rand);
    for (let it = 0; it < 40; it++) {
      const xv = X.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));
      const w = new Array(d).fill(0);
      X.forEach((r, i) => { for (let j = 0; j < d; j++) w[j] += r[j] * xv[i]; });
      for (const p of comps) { const dot = w.reduce((s, x, j) => s + x * p[j], 0); for (let j = 0; j < d; j++) w[j] -= dot * p[j]; }
      const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
      v = w.map((x) => x / norm);
    }
    comps.push(v);
  }
  return X.map((r) => [r.reduce((s, x, j) => s + x * comps[0][j], 0), r.reduce((s, x, j) => s + x * comps[1][j], 0)]);
}
