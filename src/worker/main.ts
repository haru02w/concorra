import "dotenv/config";
import { JOB_NAMES } from "@/modules/shared/ports";
import { createContainer } from "@/infrastructure/container";
import { createHandlers, HEAVY_JOBS, SCHEDULES } from "./handlers";

async function main() {
  const { env, boss, jobs, storage, services, db } = createContainer("worker");
  await storage.ensureBucket();
  await jobs.start();

  const handlers = createHandlers(services);
  for (const name of JOB_NAMES) {
    const localConcurrency = HEAVY_JOBS.includes(name) ? env.WORKER_CONCURRENCY : env.WORKER_CONCURRENCY * 2;
    await boss.work(name, { batchSize: 1, localConcurrency, pollingIntervalSeconds: 2 }, async ([job]) => {
      const started = Date.now();
      try {
        const result = await (handlers[name] as (data: unknown) => Promise<unknown>)(job.data);
        console.log(`[job] ${name} ${job.id} ok in ${Date.now() - started}ms`);
        return result ?? null;
      } catch (error) {
        console.error(`[job] ${name} ${job.id} failed:`, error);
        throw error;
      }
    });
  }
  for (const { name, cron } of SCHEDULES) {
    await boss.schedule(name, cron, {}, { tz: "America/Sao_Paulo" });
  }
  console.log(`[worker] ${JOB_NAMES.length} queues, ${SCHEDULES.length} schedules`);

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal}, stopping…`);
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
