import { PgBoss } from "pg-boss";
import { JOB_NAMES, type JobName, type JobPayloads, type JobQueue } from "@/application/ports";

type QueueOptions = Parameters<PgBoss["createQueue"]>[1];

/** Long, external or heavy jobs get longer timeouts; syncs run one at a time. */
export const QUEUE_OPTIONS: Partial<Record<JobName, QueueOptions>> = {
  "pncp.sync-open": { policy: "singleton", expireInSeconds: 3600, retryLimit: 1 },
  "pncp.sync-updates": { policy: "singleton", expireInSeconds: 3600, retryLimit: 1 },
  "pncp.sync-contracts": { policy: "singleton", expireInSeconds: 3600, retryLimit: 1 },
  "notify.digest": { policy: "singleton", retryLimit: 2 },
  "docs.expiry-watch": { policy: "singleton", retryLimit: 2 },
  "notice.ingest-files": { expireInSeconds: 1800 },
  "analysis.run": { expireInSeconds: 1200 },
  "bid.build-pack": { expireInSeconds: 3600 },
  "bid.render-doc": { expireInSeconds: 600 },
};

const DEFAULTS: QueueOptions = { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 900 };

export function createBoss(connectionString: string, role: "web" | "worker"): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: "pgboss",
    max: role === "web" ? 3 : 6,
    // Only the worker supervises queues and runs cron schedules.
    supervise: role === "worker",
    schedule: role === "worker",
  });
  boss.on("error", (error) => console.error("[pg-boss]", error));
  return boss;
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  const existing = new Set((await boss.getQueues()).map((q) => q.name));
  for (const name of JOB_NAMES) {
    if (!existing.has(name)) await boss.createQueue(name, { ...DEFAULTS, ...QUEUE_OPTIONS[name] });
  }
}

/** JobQueue port backed by pg-boss; starts the client lazily on first use. */
export class PgBossJobQueue implements JobQueue {
  private ready: Promise<void> | null = null;

  constructor(private readonly boss: PgBoss) {}

  start(): Promise<void> {
    this.ready ??= this.boss.start().then(() => ensureQueues(this.boss));
    return this.ready;
  }

  async enqueue<K extends JobName>(name: K, data: JobPayloads[K], options: { singletonKey?: string; startAfterSeconds?: number } = {}): Promise<void> {
    await this.start();
    await this.boss.send(name, data as object, {
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
    });
  }
}
