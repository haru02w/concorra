import type { CalendarRefType } from "@/domain/calendar/deadlines";
import type { Db } from "@/infrastructure/db/client";
import type * as M from "@/infrastructure/db/generated/client";

export type CalendarProviderId = "google" | "microsoft";

export interface CalendarConnection {
  id: string;
  userId: string;
  organizationId: string;
  provider: CalendarProviderId;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  calendarId: string;
  email: string | null;
}

export interface CalendarRepository {
  upsertConnection(data: Omit<CalendarConnection, "id">): Promise<CalendarConnection>;
  updateTokens(id: string, tokens: Pick<CalendarConnection, "accessToken" | "refreshToken" | "expiresAt">): Promise<void>;
  listByOrg(organizationId: string): Promise<CalendarConnection[]>;
  listByUser(userId: string, organizationId: string): Promise<CalendarConnection[]>;
  deleteConnection(userId: string, id: string): Promise<void>;
  findEvent(connectionId: string, key: string): Promise<{ id: string; externalId: string } | null>;
  saveEvent(data: { connectionId: string; key: string; refType: CalendarRefType; refId: string; externalId: string }): Promise<void>;
  listEventsByRef(refType: CalendarRefType, refId: string): Promise<{ id: string; connectionId: string; key: string; externalId: string }[]>;
  deleteEvent(id: string): Promise<void>;
}

// ---------- Prisma ----------

export const toConnection = (r: M.CalendarConnection): CalendarConnection => ({
  id: r.id,
  userId: r.userId,
  organizationId: r.organizationId,
  provider: r.provider as CalendarProviderId,
  accessToken: r.accessToken,
  refreshToken: r.refreshToken,
  expiresAt: r.expiresAt,
  calendarId: r.calendarId,
  email: r.email,
});

export class PrismaCalendarRepository implements CalendarRepository {
  constructor(private db: Db) {}
  async upsertConnection(data: Omit<CalendarConnection, "id">) {
    return toConnection(
      await this.db.calendarConnection.upsert({
        where: { userId_organizationId_provider: { userId: data.userId, organizationId: data.organizationId, provider: data.provider } },
        create: data,
        update: data,
      }),
    );
  }
  async updateTokens(id: string, tokens: Pick<CalendarConnection, "accessToken" | "refreshToken" | "expiresAt">) {
    await this.db.calendarConnection.update({ where: { id }, data: tokens });
  }
  async listByOrg(organizationId: string) {
    return (await this.db.calendarConnection.findMany({ where: { organizationId } })).map(toConnection);
  }
  async listByUser(userId: string, organizationId: string) {
    return (await this.db.calendarConnection.findMany({ where: { userId, organizationId } })).map(toConnection);
  }
  async deleteConnection(userId: string, id: string) {
    await this.db.calendarConnection.deleteMany({ where: { id, userId } });
  }
  async findEvent(connectionId: string, key: string) {
    return this.db.calendarEvent.findUnique({ where: { connectionId_key: { connectionId, key } }, select: { id: true, externalId: true } });
  }
  async saveEvent(data: { connectionId: string; key: string; refType: CalendarRefType; refId: string; externalId: string }) {
    await this.db.calendarEvent.upsert({
      where: { connectionId_key: { connectionId: data.connectionId, key: data.key } },
      create: data,
      update: { externalId: data.externalId },
    });
  }
  async listEventsByRef(refType: CalendarRefType, refId: string) {
    return this.db.calendarEvent.findMany({ where: { refType, refId }, select: { id: true, connectionId: true, key: true, externalId: true } });
  }
  async deleteEvent(id: string) {
    await this.db.calendarEvent.deleteMany({ where: { id } });
  }
}
