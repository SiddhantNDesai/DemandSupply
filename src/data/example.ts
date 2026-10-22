// Example data: two years of weekly store x size rows with NSQ, SOH, AVAL and returns, streamed into a sink.
import { dateOf, dayOf, isoDay } from "./types";

export const EXAMPLE_HEADERS = ["Date", "Channel", "Store Code", "Cluster", "Region", "UPC", "Style", "Size", "TENET 9", "MRP",
  "Disc %", "NSQ", "NSV", "MRP Sale Value", "SOH", "AVAL", "LFL/NLFL", "OMNI /OFFLINE"];
export const EXAMPLE_GROUPS: Record<string, string> = { LIGHT: "Light", "ECOVERO VISCOSE": "Light", MID: "Mid", INTERLOCK: "Mid", TERRY: "Heavy" };

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function generateExample(sink: (row: unknown[]) => void, seed = 11) {
  const rnd = mulberry32(seed);
  const normal = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pois = (l: number) => {
    if (l <= 0) return 0;
    if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * normal()));
    const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1;
  };
  const clusters: [string, string, number, number, number][] = [["NORTH METRO", "North", 8, 4, 1.10], ["NORTH UPCOUNTRY", "North", 7, 4, .95],
    ["SOUTH METRO", "South", 9, 9, 1.22], ["WEST METRO", "West", 8, 6, 1.12], ["EAST", "East", 6, 5, 1.05]];
  const fab: Record<string, [number, number, Record<string, number>]> = {
    LIGHT: [.05, 1, { North: .6, South: 1.5, West: 1.2, East: .9 }], "ECOVERO VISCOSE": [.1, .9, { North: .5, South: 1.4, West: 1.2, East: .8 }],
    MID: [.5, .45, { North: 1, South: .9, West: 1, East: 1 }], INTERLOCK: [.8, .1, { North: 1.3, South: .7, West: .9, East: 1 }],
    TERRY: [1, 0, { North: 1.9, South: .3, West: .6, East: 1.2 }] };
  const code: Record<string, string> = { LIGHT: "L", "ECOVERO VISCOSE": "V", MID: "M", INTERLOCK: "I", TERRY: "T" };
  const sizes: [string, number][] = [["S", .25], ["M", .4], ["L", .35]];
  const start = dayOf(2024, 4, 1), W = 104;
  const days = Array.from({ length: W }, (_, w) => start + 7 * w);
  const near = (d: number, mo: number, dd: number, sig: number) => {
    const y = dateOf(d).getUTCFullYear(); let best = 1e9;
    for (const yy of [y - 1, y, y + 1]) best = Math.min(best, Math.abs(d - dayOf(yy, mo, dd)));
    return Math.exp(-((best / 7) ** 2) / (2 * sig * sig));
  };
  const eoss = days.map((d) => { const x = dateOf(d), m = x.getUTCMonth() + 1, dd = x.getUTCDate(); return (m === 1 && dd >= 15) || (m === 2 && dd <= 15) || m === 7; });
  let sc = 1001;
  for (const [cl, rg, nSt, wsig, g2] of clusters) {
    const curves: Record<string, number[]> = {};
    for (const f in fab) curves[f] = days.map((d) => fab[f][0] * near(d, 12, 15, wsig) + fab[f][1] * near(d, 5, 10, 6) + .12);
    for (let s = 0; s < nSt; s++) {
      const store = "ST" + sc++, size = .6 + rnd() * .9, lfl = rnd() < .85 ? "LFL" : "NLFL";
      for (const f in fab) for (const k of [1, 2]) {
        const style = `TS-${code[f]}${100 + k}`, mrp = k === 1 ? 1299 : 1799, inten = fab[f][2][rg] * (k === 1 ? 1.2 : .8);
        const lam = days.map((_, w) => 2.4 * size * inten * curves[f][w] * (eoss[w] ? 1.4 : 1) * (w >= 52 ? g2 : 1) * 1.5);
        const bias = Math.min(1.5, Math.max(.45, 1.15 - .35 * (inten - 1) + .15 * normal())); // hot cells were under-stocked
        for (const [sz, share] of sizes) {
          const upc = `${style}-${sz}`;
          let stock = 0;
          for (let w = 0; w < W; w++) {
            if (w % 4 === 0 && rnd() > .2) { const target = Math.round(lam.slice(w, w + 4).reduce((a, b) => a + b, 0) * share * bias); stock += Math.max(0, target - stock); }
            const sold = Math.min(pois(lam[w] * share), stock);
            stock -= sold;
            const disc = eoss[w] ? 30 + 5 * Math.floor(rnd() * 3) : (rnd() < .15 ? 10 : 0);
            const ch = rnd() < .04 ? "OMNI" : "OFFLINE";
            const base = (date: string, nsq: number, soh: number) => [date, "EBO", store, cl, rg, upc, style, sz, f, mrp, disc, nsq,
              Math.round(nsq * mrp * (1 - disc / 100)), nsq * mrp, soh, nsq + soh, lfl, ch];
            if (sold > 0 || stock > 0) sink(base(isoDay(days[w]), sold, stock));
            if (sold > 0 && rnd() < .04) { stock += 1; sink(base(isoDay(days[w] + 3), -1, stock)); }
          }
        }
      }
    }
  }
}
