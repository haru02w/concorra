import { execFileSync } from "node:child_process";
import pg from "pg";
import { createPrisma, type Db } from "./client";

/** Creates (once) and migrates a dedicated `<db>_test` database next to DATABASE_URL. */
export async function createTestDb(): Promise<{ db: Db; url: string; reset: () => Promise<void> }> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required for integration tests");
  const url = new URL(base);
  const name = `${url.pathname.slice(1)}_test`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  url.pathname = `/${name}`;
  const testUrl = url.toString();
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl }, stdio: "ignore" });
  const db = createPrisma(testUrl);
  const reset = async () => {
    const tables = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  };
  return { db, url: testUrl, reset };
}
