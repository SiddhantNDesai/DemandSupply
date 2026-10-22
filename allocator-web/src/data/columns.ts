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
  const byNorm = new Map(headers.map((h) => [normHeader(h), h]));
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
