import type { Deps, Match, NotificationType } from "../shared/ports";
import type { Notice } from "@/domain/notice/notice";
import type { Channel } from "@/domain/rules/rule";
import type { Actor } from "../shared/context";

export interface OrgMessage {
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function emailHtml(message: OrgMessage, appUrl: string, extra = ""): string {
  const link = message.link ? `${appUrl}${message.link}` : appUrl;
  return `<div style="font-family:system-ui,sans-serif;max-width:560px">
<h2 style="margin:0 0 12px">${escapeHtml(message.title)}</h2>
<p style="white-space:pre-line">${escapeHtml(message.body)}</p>${extra}
<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Abrir no Concorra</a></p>
<p style="color:#888;font-size:12px">Concorra — análise assistida por IA; confira sempre o edital.</p></div>`;
}

function noticeLine(notice: Notice): string {
  const value = notice.valorEstimado ? ` — R$ ${notice.valorEstimado.toLocaleString("pt-BR")}` : "";
  return `• ${notice.objeto.slice(0, 160)} (${notice.orgaoNome}, ${notice.uf ?? "-"})${value}`;
}

export class NotificationsService {
  constructor(private readonly deps: Deps) {}

  /** Sends an in-app notification (all members) and/or an email to every member. */
  async notifyOrganization(organizationId: string, message: OrgMessage, channels: Channel[] = ["inapp", "email"], extraHtml = ""): Promise<void> {
    const members = await this.deps.memberships.listByOrg(organizationId);
    if (channels.includes("inapp")) {
      for (const member of members) {
        await this.deps.notifications.create({ organizationId, userId: member.user.id, ...message });
      }
    }
    if (channels.includes("email")) {
      const to = members.map((m) => m.user.email);
      if (to.length) {
        await this.deps.mailer.send({
          to,
          subject: message.title,
          html: emailHtml(message, this.deps.config.appUrl, extraHtml),
          text: `${message.body}\n\n${this.deps.config.appUrl}${message.link ?? ""}`,
        });
      }
    }
  }

  private async deliver(matches: Match[], type: "match" | "digest"): Promise<number> {
    const byOrg = Map.groupBy(matches, (m) => m.organizationId);
    for (const [organizationId, orgMatches] of byOrg) {
      const noticeIds = [...new Set(orgMatches.map((m) => m.noticeId))];
      const notices = (await Promise.all(noticeIds.map((id) => this.deps.notices.findById(id)))).filter((n): n is Notice => !!n);
      if (!notices.length) continue;
      const channels = [...new Set(orgMatches.flatMap((m) => m.channels))];
      const title =
        type === "digest"
          ? `Resumo diário: ${notices.length} nova(s) licitação(ões)`
          : notices.length === 1
            ? `Nova licitação: ${notices[0].objeto.slice(0, 80)}`
            : `${notices.length} novas licitações para você`;
      await this.notifyOrganization(organizationId,
        { type, title, body: notices.map(noticeLine).join("\n"), link: notices.length === 1 ? `/radar/${notices[0].id}` : "/radar" },
        channels,
      );
    }
    await this.deps.matches.setStatus(matches.map((m) => m.id), "notified", this.deps.clock.now());
    return matches.length;
  }

  /** Job: immediate match notifications. */
  async sendMatchNotifications(input: { matchIds: string[] }): Promise<number> {
    const matches = (await this.deps.matches.listByIds(input.matchIds)).filter((m) => m.status === "notify");
    return this.deliver(matches, "match");
  }

  /** Job (daily schedule): one digest per organization. */
  async sendDigest(): Promise<number> {
    return this.deliver(await this.deps.matches.listForDigest(), "digest");
  }

  async listNotifications(actor: Actor) {
    return this.deps.notifications.listForUser(actor.organizationId, actor.userId, 50);
  }

  async markNotificationsRead(actor: Actor, ids: string[] | "all") {
    await this.deps.notifications.markRead(actor.organizationId, actor.userId, ids);
  }

  async countUnread(actor: Actor): Promise<number> {
    return this.deps.notifications.countUnread(actor.organizationId, actor.userId);
  }

  /** Resend delivery events, recorded idempotently. */
  async recordEmailEvent(id: string, payload: unknown): Promise<void> {
    await this.deps.webhookEvents.recordOnce("resend", id, payload);
  }
}
