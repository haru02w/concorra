import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ActionForm } from "@/web/components/action-form";
import { formatDateTime } from "@/web/components/format";
import { SubmitButton } from "@/web/components/submit-button";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { markAllReadAction } from "@/modules/notifications/notifications.actions";

export const metadata = { title: "Notificações" };

const TYPES: Record<string, string> = {
  match: "Nova licitação",
  digest: "Resumo diário",
  analysis_ready: "Análise",
  document_expiring: "Vencimento",
  document_validated: "Documento",
  bid_pack_ready: "Pacote",
  billing: "Plano",
};

export default async function NotificationsPage() {
  const { actor } = await requireActor();
  const notifications = await getServices().notifications.listNotifications(actor);
  const unread = notifications.some((n) => !n.readAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notificações</h1>
        {unread && (
          <ActionForm action={markAllReadAction}>
            <SubmitButton variant="outline" size="sm">
              Marcar todas como lidas
            </SubmitButton>
          </ActionForm>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma notificação ainda.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card key={n.id} size="sm" className={n.readAt ? "opacity-70" : undefined}>
              <CardContent className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={n.readAt ? "outline" : "default"}>{TYPES[n.type] ?? n.type}</Badge>
                  <span className="text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                </div>
                <div className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</div>
                {n.body && <p className="text-sm whitespace-pre-line text-muted-foreground">{n.body}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
