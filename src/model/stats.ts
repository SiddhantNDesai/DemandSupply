export function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
export const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
export const phi = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

/** Chance that demand is at least k units (normal approximation with continuity correction). */
export const pGE = (k: number, mu: number, sd: number) => (mu <= 0 ? 0 : 1 - Phi((k - 0.5 - mu) / sd));

/** Expected sales, expected lost sales and stockout risk when Q units are available. */
export function cellStats(Q: number, mu: number, sd: number) {
  if (mu <= 0) return { es: 0, lost: 0, risk: 0 };
  const z = (Q - mu) / sd;
  const L = phi(z) - z * (1 - Phi(z));
  const es = Math.max(0, Math.min(mu - sd * L, Q, mu));
  return { es, lost: mu - es, risk: 1 - Phi((Q + 0.5 - mu) / sd) };
}

export function largestRemainder(weights: number[], total: number): number[] {
  const s = weights.reduce((a, b) => a + b, 0);
  total = Math.round(total);
  if (s <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((v) => (v / s) * total), fl = raw.map(Math.floor);
  const rem = total - fl.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).slice(0, Math.max(0, rem)).forEach(([, i]) => fl[i]++);
  return fl;
}

export class MaxHeap<T> {
  private a: { v: number; x: T }[] = [];
  get size() { return this.a.length; }
  push(v: number, x: T) {
    const a = this.a; a.push({ v, x }); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].v >= a[i].v) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): { v: number; x: T } {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].v > a[m].v) m = l; if (r < a.length && a[r].v > a[m].v) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; }
    }
    return top;
  }
}
