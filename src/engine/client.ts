// Page-side client for the engine worker, plus a hook that keeps only the latest answer.
import { useEffect, useRef, useState } from "react";
import type { Request, Response } from "./protocol";

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void; onProgress?: (r: Extract<Response, { type: "progress" }>) => void };
type Body<T extends Request["type"]> = Omit<Extract<Request, { type: T }>, "id">;
type ResponseFor<T extends Request["type"]> = T extends "load" ? Extract<Response, { type: "loaded" }> : Extract<Response, { type: T }>;

class Engine {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  constructor() {
    this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<Response>) => {
      const r = e.data, p = this.pending.get(r.id);
      if (!p) return;
      if (r.type === "progress") { p.onProgress?.(r); return; }
      this.pending.delete(r.id);
      if (r.type === "error") p.reject(Object.assign(new Error(r.message), { headers: r.headers, mapping: r.mapping, sheets: r.sheets, sheet: r.sheet }));
      else p.resolve(r);
    };
    this.worker.onerror = (e) => { for (const p of this.pending.values()) p.reject(new Error(e.message || "The calculation engine stopped.")); this.pending.clear(); };
  }
  send<T extends Request["type"]>(body: Body<T>, onProgress?: Pending["onProgress"]): Promise<ResponseFor<T>> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: Response) => void, reject, onProgress });
      this.worker.postMessage({ ...body, id } as unknown as Request);
    });
  }
}

export const engine = new Engine();

/** Run an engine query whenever `key` changes; older answers that arrive late are ignored. */
export function useEngine<T>(key: string | null, run: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; error: string | null; busy: boolean }>({ data: null, error: null, busy: false });
  const latest = useRef(0);
  useEffect(() => {
    if (key === null) return;
    const n = ++latest.current;
    setState((s) => ({ ...s, busy: true }));
    run().then((data) => { if (n === latest.current) setState({ data, error: null, busy: false }); })
      .catch((e: Error) => { if (n === latest.current) setState((s) => ({ data: s.data, error: e.message, busy: false })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
