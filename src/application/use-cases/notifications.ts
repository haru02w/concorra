import type { Deps, Match, NotificationType } from "../ports";
import type { Notice } from "@/domain/notice/notice";
import type { Channel } from "@/domain/rules/rule";
import type { Actor } from "./context";

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

/** Sends an in-app notification (all members) and/or an email to every member. */
export async function notifyOrganization(
  deps: Pick<Deps, "notifications" | "memberships" | "mailer" | "config">,
  organizationId: string,
  message: OrgMessage,
  channels: Channel[] = ["inapp", "email"],
  extraHtml = "",
): Promise<void> {
  const members = await deps.memberships.listByOrg(organizationId);
  if (channels.includes("inapp")) {
    for (const member of members) {
      await deps.notifications.create({ organizationId, userId: member.user.id, ...message });
    }
  }
  if (channels.includes("email")) {
    const to = members.map((m) => m.user.email);
    if (to.length) {
      await deps.mailer.send({
        to,
        subject: message.title,
        html: emailHtml(message, deps.config.appUrl, extraHtml),
        text: `${message.body}\n\n${deps.config.appUrl}${message.link ?? ""}`,
      });
    }
  }
}

function noticeLine(notice: Notice): string {
  const value = notice.valorEstimado ? ` — R$ ${notice.valorEstimado.toLocaleString("pt-BR")}` : "";
  return `• ${notice.objeto.slice(0, 160)} (${notice.orgaoNome}, ${notice.uf ?? "-"})${value}`;
}

async function deliver(
  deps: Pick<Deps, "notifications" | "memberships" | "mailer" | "config" | "notices" | "matches" | "clock">,
  matches: Match[],
  type: "match" | "digest",
): Promise<number> {
  const byOrg = Map.groupBy(matches, (m) => m.organizationId);
  for (const [organizationId, orgMatches] of byOrg) {
    const noticeIds = [...new Set(orgMatches.map((m) => m.noticeId))];
    const notices = (await Promise.all(noticeIds.map((id) => deps.notices.findById(id)))).filter((n): n is Notice => !!n);
    if (!notices.length) continue;
    const channels = [...new Set(orgMatches.flatMap((m) => m.channels))];
    const title =
      type === "digest"
        ? `Resumo diário: ${notices.length} nova(s) licitação(ões)`
        : notices.length === 1
          ? `Nova licitação: ${notices[0].objeto.slice(0, 80)}`
          : `${notices.length} novas licitações para você`;
    await notifyOrganization(
      deps,
      organizationId,
      { type, title, body: notices.map(noticeLine).join("\n"), link: notices.length === 1 ? `/radar/${notices[0].id}` : "/radar" },
      channels,
    );
  }
  await deps.matches.setStatus(matches.map((m) => m.id), "notified", deps.clock.now());
  return matches.length;
}

/** Job: immediate match notifications. */
export async function sendMatchNotifications(
  deps: Pick<Deps, "notifications" | "memberships" | "mailer" | "config" | "notices" | "matches" | "clock">,
  input: { matchIds: string[] },
): Promise<number> {
  const matches = (await deps.matches.listByIds(input.matchIds)).filter((m) => m.status === "notify");
  return deliver(deps, matches, "match");
}

/** Job (daily schedule): one digest per organization. */
export async function sendDigest(
  deps: Pick<Deps, "notifications" | "memberships" | "mailer" | "config" | "notices" | "matches" | "clock">,
): Promise<number> {
  return deliver(deps, await deps.matches.listForDigest(), "digest");
}

export async function listNotifications(deps: Pick<Deps, "notifications">, actor: Actor) {
  return deps.notifications.listForUser(actor.organizationId, actor.userId, 50);
}

export async function markNotificationsRead(deps: Pick<Deps, "notifications">, actor: Actor, ids: string[] | "all") {
  await deps.notifications.markRead(actor.organizationId, actor.userId, ids);
}
