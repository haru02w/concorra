import { formatBrl, PLANS, type LimitedMetric } from "@/domain/billing/plans";
import { canManage } from "@/domain/organization/organization";
import { getUsageSummary } from "@/application/use-cases/billing";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ActionForm } from "@/web/components/action-form";
import { formatDate } from "@/web/components/format";
import { SubmitButton } from "@/web/components/submit-button";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { checkoutAction } from "./actions";
import { CancelSubscriptionButton } from "./cancel-button";

export const metadata = { title: "Plano" };

const METRICS: { key: LimitedMetric; label: string }[] = [
  { key: "analyses", label: "Análises de IA (mês)" },
  { key: "bidPacks", label: "Pacotes de licitação (mês)" },
  { key: "rules", label: "Regras ativas" },
  { key: "members", label: "Membros" },
];

const STATUS: Record<string, string> = { active: "Ativa", pending: "Pendente", cancelled: "Cancelada" };
const limitText = (n: number | null) => (n === null ? "Ilimitado" : String(n));

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const { actor } = await requireActor();
  const { plan, period, subscription, used } = await getUsageSummary(getDeps(), actor.organizationId);
  const owner = canManage(actor.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Plano</h1>
        <p className="text-muted-foreground">Pagamentos via AbacatePay (Pix ou cartão). Na demonstração, tudo roda em modo sandbox.</p>
      </div>

      {checkout === "done" && (
        <Alert>
          <AlertTitle>Pagamento em processamento</AlertTitle>
          <AlertDescription>O plano muda assim que a AbacatePay confirmar.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Plano {plan.name}
            {subscription && <Badge variant="outline">{STATUS[subscription.status] ?? subscription.status}</Badge>}
            {subscription?.pendingPlanId && <Badge variant="secondary">Aguardando pagamento: {PLANS[subscription.pendingPlanId].name}</Badge>}
          </CardTitle>
          <CardDescription>
            Uso em {period}
            {subscription?.currentPeriodEnd && ` · renova em ${formatDate(subscription.currentPeriodEnd)}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {METRICS.map(({ key, label }) => {
            const limit = plan.limits[key];
            const value = used[key];
            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="text-muted-foreground">
                    {value} / {limitText(limit)}
                  </span>
                </div>
                <Progress value={limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (value / limit) * 100)} />
              </div>
            );
          })}
        </CardContent>
        {owner && subscription?.subscriptionRef && (
          <CardFooter>
            <CancelSubscriptionButton />
          </CardFooter>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {Object.values(PLANS).map((p) => {
          const current = p.id === plan.id;
          return (
            <Card key={p.id} className={current ? "ring-2 ring-primary" : undefined}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardDescription className="text-2xl font-semibold text-foreground">
                  {formatBrl(p.priceCents)}
                  <span className="text-sm font-normal text-muted-foreground">/mês</span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  <li>Membros: {limitText(p.limits.members)}</li>
                  <li>Regras ativas: {limitText(p.limits.rules)}</li>
                  <li>Análises/mês: {limitText(p.limits.analyses)}</li>
                  <li>Pacotes/mês: {limitText(p.limits.bidPacks)}</li>
                </ul>
              </CardContent>
              <CardFooter>
                {current ? (
                  <Badge>Plano atual</Badge>
                ) : p.id !== "free" && owner ? (
                  <ActionForm action={checkoutAction}>
                    <input type="hidden" name="planId" value={p.id} />
                    <SubmitButton pendingText="Abrindo checkout…">Assinar {p.name}</SubmitButton>
                  </ActionForm>
                ) : p.id !== "free" ? (
                  <span className="text-xs text-muted-foreground">Somente o responsável pode assinar.</span>
                ) : null}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
