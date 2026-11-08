import { MODALIDADES } from "@/domain/notice/notice";
import { PLANS } from "@/domain/billing/plans";
import { formatCnpj } from "@/domain/shared/cnpj";
import type { Rule } from "@/domain/rules/rule";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/web/components/format";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { RuleActions } from "./rule-actions";
import { RuleForm } from "./rule-form";

export const metadata = { title: "Regras" };

function summary(rule: Rule): string[] {
  const f = rule.filters;
  const parts: string[] = [];
  if (f.keywordsInclude.length) parts.push(`Inclui: ${f.keywordsInclude.join(", ")}`);
  if (f.keywordsExclude.length) parts.push(`Exclui: ${f.keywordsExclude.join(", ")}`);
  parts.push(f.ufs.length ? `UF: ${f.ufs.join(", ")}` : "Todo o Brasil");
  if (f.modalidadeIds.length) parts.push(f.modalidadeIds.map((id) => MODALIDADES[id] ?? id).join(", "));
  if (f.valueMin !== null || f.valueMax !== null) parts.push(`Valor: ${formatMoney(f.valueMin)} a ${formatMoney(f.valueMax)}`);
  if (f.orgaoCnpjs.length) parts.push(`Órgãos: ${f.orgaoCnpjs.map(formatCnpj).join(", ")}`);
  if (rule.semanticThreshold !== null) parts.push(`Similaridade ≥ ${rule.semanticThreshold}`);
  if (rule.minScore !== null) parts.push(`Score ≥ ${rule.minScore}`);
  return parts;
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const { actor, session } = await requireActor();
  const rules = await getServices().rules.listRules(actor);
  const editing = edit ? (rules.find((r) => r.id === edit) ?? null) : null;
  const limit = PLANS[session.organization!.planId].limits.rules;
  const active = rules.filter((r) => r.active).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Regras de notificação</h1>
        <p className="text-sm text-muted-foreground">
          Filtros salvos que avisam quando uma licitação do PNCP combina com o que a empresa faz. Regras ativas: {active}
          {limit === null ? "" : ` de ${limit}`} no plano atual.
        </p>
      </div>

      {rules.length > 0 && (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id} size="sm">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {rule.name}
                  <Badge variant={rule.active ? "default" : "outline"}>{rule.active ? "Ativa" : "Inativa"}</Badge>
                  <Badge variant="secondary">{rule.frequency === "daily" ? "Resumo diário" : "Imediata"}</Badge>
                  {rule.channels.map((c) => (
                    <Badge key={c} variant="outline">
                      {c === "email" ? "E-mail" : "No app"}
                    </Badge>
                  ))}
                </CardTitle>
                <CardDescription>{summary(rule).join(" · ")}</CardDescription>
              </CardHeader>
              <CardContent>
                <RuleActions id={rule.id} active={rule.active} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{editing ? `Editar regra: ${editing.name}` : "Nova regra"}</CardTitle>
          <CardDescription>Use ao menos um filtro. Palavras-chave e similaridade semântica podem ser combinadas.</CardDescription>
        </CardHeader>
        <CardContent>
          <RuleForm rule={editing} />
        </CardContent>
      </Card>
    </div>
  );
}
