// Column roles and header matching (NSQ -> qty, TENET 9 -> fabric, ...)
export type Role =
  | "date" | "cluster" | "store" | "qty" | "soh" | "aval" | "upc" | "value" | "mrpv"
  | "style" | "fabric" | "region" | "disc" | "lfl" | "channel";

export type Mapping = Partial<Record<Role, string>>;

export const ROLES: { key: Role; label: string; req: boolean; guess: string[] }[] = [
  { key: "date", label: "Date", req: true, guess: ["date", "bill date", "invoice date"] },
  { key: "cluster", label: "Cluster", req: true, guess: ["cluster"] },
  { key: "store", label: "Store code", req: true, guess: ["store code", "storecode", "store id"] },
  { key: "qty", label: "Net sale qty (NSQ)", req: true, guess: ["nsq", "qty", "quantity", "sales qty"] },
  { key: "soh", label: "Stock on hand (SOH)", req: false, guess: ["soh", "stock on hand", "closing stock"] },
  { key: "aval", label: "Available (AVAL)", req: false, guess: ["aval", "available"] },
  { key: "upc", label: "UPC / size code", req: false, guess: ["upc", "ean", "barcode"] },
  { key: "value", label: "Sales value (NSV)", req: false, guess: ["nsv", "net sales value", "sales value"] },
  { key: "mrpv", label: "Sales value at MRP", req: false, guess: ["mrp sale value", "mrp value"] },
  { key: "style", label: "Style (SKU)", req: false, guess: ["style"] },
  { key: "fabric", label: "Fabric / SKU type", req: false, guess: ["tenet 9", "tenet9", "fabric"] },
  { key: "region", label: "Region", req: false, guess: ["region"] },
  { key: "disc", label: "Discount %", req: false, guess: ["disc %", "disc%", "discount %", "discount"] },
  { key: "lfl", label: "LFL / NLFL", req: false, guess: ["lfl/nlfl", "lfl"] },
  { key: "channel", label: "Online / offline", req: false, guess: ["omni/offline", "channel type"] },
];

export const normHeader = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();

export function guessMapping(headers: string[]): Mapping {
  const byNorm = new Map<string, string>();
  for (const h of Array.from(headers)) if (h !== undefined && !byNorm.has(normHeader(h))) byNorm.set(normHeader(h), String(h));
  const out: Mapping = {};
  for (const r of ROLES) {
    for (const g of r.guess) {
      const h = byNorm.get(normHeader(g));
      if (h !== undefined) { out[r.key] = h; break; }
    }
  }
  return out;
}

export const missingRequired = (m: Mapping) => ROLES.filter((r) => r.req && !m[r.key]).map((r) => r.label);

/** Header names from a raw row: blanks become "Column N", repeats get " (2)", gaps in sparse rows are filled. */
export function cleanHeaders(row: ArrayLike<unknown> | undefined): string[] {
  const seen = new Map<string, number>();
  return Array.from(row ?? [], (v, i) => {
    let h = String(v ?? "").trim() || `Column ${i + 1}`;
    const n = (seen.get(h) ?? 0) + 1; seen.set(h, n);
    if (n > 1) h = `${h} (${n})`;
    return h;
  });
}

/** Find the header row among the first rows: the one that matches the most known columns (skips title lines). */
export function pickHeaderRow(rows: (ArrayLike<unknown> | undefined)[]): number {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    if (!r || !Array.from(r).some((v) => v !== null && v !== undefined && String(v).trim() !== "")) continue;
    const score = Object.keys(guessMapping(cleanHeaders(r))).length;
    if (best < 0 && score === 0) best = i;            // first non-empty row as a fallback
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return Math.max(best, 0);
}
