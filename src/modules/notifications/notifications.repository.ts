import type { Db } from "@/infrastructure/db/client";
import type * as M from "@/infrastructure/db/generated/client";

export type NotificationType = "match" | "digest" | "analysis_ready" | "document_expiring" | "document_validated" | "bid_pack_ready" | "billing";

export interface Notification {
  id: string;
  organizationId: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationRepository {
  create(data: Omit<Notification, "id" | "readAt" | "createdAt">): Promise<Notification>;
  listForUser(organizationId: string, userId: string, limit: number): Promise<Notification[]>;
  countUnread(organizationId: string, userId: string): Promise<number>;
  markRead(organizationId: string, userId: string, ids: string[] | "all"): Promise<void>;
}

// ---------- Prisma ----------

export const toNotification = (r: M.Notification): Notification => ({
  id: r.id,
  organizationId: r.organizationId,
  userId: r.userId,
  type: r.type as NotificationType,
  title: r.title,
  body: r.body,
  link: r.link,
  readAt: r.readAt,
  createdAt: r.createdAt,
});

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private db: Db) {}
  async create(data: Omit<Notification, "id" | "readAt" | "createdAt">) {
    return toNotification(await this.db.notification.create({ data }));
  }
  async listForUser(organizationId: string, userId: string, limit: number) {
    const rows = await this.db.notification.findMany({
      where: { organizationId, OR: [{ userId }, { userId: null }] },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toNotification);
  }
  async countUnread(organizationId: string, userId: string) {
    return this.db.notification.count({ where: { organizationId, readAt: null, OR: [{ userId }, { userId: null }] } });
  }
  async markRead(organizationId: string, userId: string, ids: string[] | "all") {
    await this.db.notification.updateMany({
      where: { organizationId, userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
      data: { readAt: new Date() },
    });
  }
}
