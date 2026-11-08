import { expect } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ApiResponse<T = any> {
  status: number;
  data: T;
  headers: Headers;
  res: Response;
}

/** Minimal HTTP client with a cookie jar, for the REST API and route handlers. */
export class Client {
  private cookies = new Map<string, string>();

  constructor(readonly baseUrl: string) {}

  async request<T = any>(method: string, path: string, options: { json?: unknown; form?: FormData } = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers["content-type"] = "application/json";
    } else if (options.form) body = options.form;
    const res = await fetch(new URL(path, this.baseUrl), { method, headers, body, redirect: "manual" });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || /max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
    return { status: res.status, data, headers: res.headers, res };
  }

  get<T = any>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T = any>(path: string, json?: unknown) {
    return this.request<T>("POST", path, { json: json ?? {} });
  }
  put<T = any>(path: string, json: unknown) {
    return this.request<T>("PUT", path, { json });
  }
  patch<T = any>(path: string, json: unknown) {
    return this.request<T>("PATCH", path, { json });
  }
  delete<T = any>(path: string) {
    return this.request<T>("DELETE", path);
  }
  upload<T = any>(path: string, fields: Record<string, string>, file: { name: string; type: string; bytes: Uint8Array }) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set("file", new Blob([Buffer.from(file.bytes)], { type: file.type }), file.name);
    return this.request<T>("POST", path, { form });
  }

  async login(email: string, name = "E2E") {
    const res = await this.post("/api/mock/login", { email, name });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    return res.data;
  }
}

/** Polls until `fn` returns a truthy value (background jobs run in the worker). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, what: string, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

export const today = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(d);
};
