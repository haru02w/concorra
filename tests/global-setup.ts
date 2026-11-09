/**
 * Boots the system for headless e2e tests: a dedicated `<db>_e2e` database,
 * the pg-boss worker and a Next.js dev server, all with MOCK_EXTERNAL=true.
 * Set E2E_BASE_URL to run the suite against an already running server instead.
 */
import "dotenv/config";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { loadEnv } from "@/infrastructure/config/env";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

const children: ChildProcess[] = [];

async function prepareDatabase(base: string): Promise<string> {
  const url = new URL(base);
  const name = `${url.pathname.slice(1)}_e2e`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  url.pathname = `/${name}`;
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "ignore" });
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  await db.query(`TRUNCATE ${tables.rows.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
  await db.end();
  return url.toString();
}

function start(name: string, args: string[], env: Record<string, string | undefined>, ready: RegExp): Promise<void> {
  mkdirSync(".next-e2e/logs", { recursive: true });
  const log = createWriteStream(`.next-e2e/logs/${name}.log`);
  const child = spawn("pnpm", ["exec", ...args], { env: env as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not start; see .next-e2e/logs/${name}.log`)), 180_000);
    const onData = (chunk: Buffer) => {
      log.write(chunk);
      if (ready.test(chunk.toString())) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", (chunk: Buffer) => log.write(chunk));
    child.on("exit", (code) => reject(new Error(`${name} exited with ${code}; see .next-e2e/logs/${name}.log`)));
  });
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const status = await fetch(url).then((r) => r.status).catch(() => 0);
    if (status && status < 500) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server did not answer at ${url}`);
}

export default async function setup(project: TestProject) {
  const config = loadEnv();
  if (config.E2E_BASE_URL) {
    project.provide("baseUrl", config.E2E_BASE_URL);
    return;
  }
  const port = config.E2E_PORT;
  const baseUrl = `http://localhost:${port}`;
  const { NODE_ENV: _nodeEnv, ...inherited } = process.env;
  const env: Record<string, string | undefined> = {
    ...inherited,
    DATABASE_URL: await prepareDatabase(config.DATABASE_URL),
    APP_URL: baseUrl,
    MOCK_EXTERNAL: "true",
    DEMO_MODE: "false",
    S3_BUCKET: "concorra-e2e",
    NEXT_DIST_DIR: ".next-e2e",
    WORKER_CONCURRENCY: "2",
    ABACATEPAY_WEBHOOK_SECRET: "e2e-webhook-secret",
  };
  await start("worker", ["tsx", "src/worker/main.ts"], env, /\[worker\] \d+ queues/);
  await start("web", ["next", "dev", "-p", String(port)], env, /Ready in/);
  await waitForHttp(`${baseUrl}/api/v1/me`);
  project.provide("baseUrl", baseUrl);

  return async () => {
    for (const child of children) {
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        // already gone
      }
    }
  };
}
