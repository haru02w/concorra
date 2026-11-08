import type { Db } from "../db/client";
import type { WorkOSLike } from "../identity/workos-identity";

export type OutboxKind = "mail" | "workos" | "payments" | "calendar";

/**
 * Records what mocked services "sent" (emails, WorkOS calls, payments, calendar
 * writes) in Postgres, so tests can assert on it across the web and worker processes.
 */
export class MockOutbox {
  constructor(private readonly db: Db) {}

  async record(kind: OutboxKind, payload: unknown): Promise<void> {
    const key = `mock:${kind}:${new Date().toISOString()}:${crypto.randomUUID()}`;
    await this.db.keyValue.create({ data: { key, value: JSON.stringify(payload) } });
  }

  async list(kind: OutboxKind): Promise<unknown[]> {
    const rows = await this.db.keyValue.findMany({ where: { key: { startsWith: `mock:${kind}:` } }, orderBy: { key: "asc" } });
    return rows.map((r) => JSON.parse(r.value));
  }

  async clear(): Promise<void> {
    await this.db.keyValue.deleteMany({ where: { key: { startsWith: "mock:" } } });
  }
}

/** Resend client stand-in (same `emails.send` shape the ResendMailer uses). */
export function mockResendClient(outbox: MockOutbox) {
  return {
    emails: {
      async send(payload: { from: string; to: string[]; subject: string; html: string; text: string }) {
        await outbox.record("mail", payload);
        console.info(`[mock mail] to=${payload.to.join(",")} subject=${JSON.stringify(payload.subject)}`);
        return { error: null };
      },
    },
  };
}

/** WorkOS client stand-in for the identity adapter. */
export function mockWorkOsClient(outbox: MockOutbox): WorkOSLike {
  const client = {
    organizations: {
      async createOrganization(input: { name: string; externalId?: string }) {
        const org = { id: `org_mock_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, ...input };
        await outbox.record("workos", { op: "createOrganization", ...org });
        return org;
      },
    },
    userManagement: {
      async createOrganizationMembership(input: { organizationId: string; userId: string; roleSlug?: string }) {
        await outbox.record("workos", { op: "createOrganizationMembership", ...input });
        return { id: `om_mock_${crypto.randomUUID().slice(0, 8)}`, ...input };
      },
      async sendInvitation(input: { email: string; organizationId?: string; roleSlug?: string; inviterUserId?: string }) {
        await outbox.record("workos", { op: "sendInvitation", ...input });
        return { id: `inv_mock_${crypto.randomUUID().slice(0, 8)}`, ...input };
      },
    },
  };
  return client as unknown as WorkOSLike;
}
