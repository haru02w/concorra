"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { MODALIDADES, UFS } from "@/domain/notice/notice";
import type { Rule } from "@/domain/rules/rule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionForm } from "@/web/components/action-form";
import { SubmitButton } from "@/web/components/submit-button";
import { saveRuleAction } from "@/modules/rules/rules.actions";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function Check({ name, value, label, defaultChecked }: { name: string; value: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

/** pt-BR formatting round-trips through formNumber ("." thousands, "," decimals). */
const money = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toLocaleString("pt-BR"));

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function RuleForm({ rule }: { rule: Rule | null }) {
  const router = useRouter();
  const f = rule?.filters;
  const done = useCallback(() => router.push("/rules"), [router]);
  return (
    <ActionForm key={rule?.id ?? "new"} action={saveRuleAction} resetOnSuccess={!rule} onSuccess={rule ? done : undefined} className="space-y-5">
      {rule && <input type="hidden" name="id" value={rule.id} />}

      <div className="space-y-1">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" name="name" required defaultValue={rule?.name ?? ""} placeholder="ex.: Limpeza no Espírito Santo" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="keywordsInclude">Palavras-chave (incluir)</Label>
          <Input id="keywordsInclude" name="keywordsInclude" defaultValue={f?.keywordsInclude.join(", ") ?? ""} placeholder="material de limpeza, higiene" />
          <Hint>Separadas por vírgula. Basta uma aparecer no objeto ou nos itens.</Hint>
        </div>
        <div className="space-y-1">
          <Label htmlFor="keywordsExclude">Palavras-chave (excluir)</Label>
          <Input id="keywordsExclude" name="keywordsExclude" defaultValue={f?.keywordsExclude.join(", ") ?? ""} placeholder="locação, obra" />
          <Hint>Licitações com qualquer uma delas são ignoradas.</Hint>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">UFs</legend>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
          {UFS.map((uf) => (
            <Check key={uf} name="ufs" value={uf} label={uf} defaultChecked={f?.ufs.includes(uf) ?? false} />
          ))}
        </div>
        <Hint>Nenhuma marcada = todo o Brasil.</Hint>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Modalidades</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(MODALIDADES).map(([id, name]) => (
            <Check key={id} name="modalidadeIds" value={id} label={name} defaultChecked={f?.modalidadeIds.includes(Number(id)) ?? false} />
          ))}
        </div>
        <Hint>Nenhuma marcada = todas.</Hint>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="valueMin">Valor mínimo (R$)</Label>
          <Input id="valueMin" name="valueMin" inputMode="decimal" defaultValue={money(f?.valueMin)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="valueMax">Valor máximo (R$)</Label>
          <Input id="valueMax" name="valueMax" inputMode="decimal" defaultValue={money(f?.valueMax)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="orgaoCnpjs">CNPJs de órgãos</Label>
          <Input id="orgaoCnpjs" name="orgaoCnpjs" defaultValue={f?.orgaoCnpjs.join(", ") ?? ""} placeholder="opcional" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="semanticThreshold">Similaridade semântica (0–1)</Label>
          <Input id="semanticThreshold" name="semanticThreshold" inputMode="decimal" defaultValue={rule?.semanticThreshold ?? ""} placeholder="ex.: 0,6 — vazio desliga" />
          <Hint>Compara o objeto da licitação com o perfil e as experiências da empresa usando IA.</Hint>
        </div>
        <div className="space-y-1">
          <Label htmlFor="minScore">Score mínimo (0–100)</Label>
          <Input id="minScore" name="minScore" inputMode="numeric" defaultValue={rule?.minScore ?? ""} placeholder="vazio desliga" />
          <Hint>A notificação espera a análise da IA e só é enviada se o score atingir este valor.</Hint>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Canais</legend>
          <Check name="channels" value="email" label="E-mail" defaultChecked={rule?.channels.includes("email") ?? true} />
          <Check name="channels" value="inapp" label="No app" defaultChecked={rule?.channels.includes("inapp") ?? true} />
        </fieldset>
        <div className="space-y-1">
          <Label htmlFor="frequency">Frequência</Label>
          <select id="frequency" name="frequency" defaultValue={rule?.frequency ?? "immediate"} className={selectClass}>
            <option value="immediate">Imediata</option>
            <option value="daily">Resumo diário</option>
          </select>
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" name="active" defaultChecked={rule?.active ?? true} className="size-4" />
          Ativa
        </label>
      </div>

      <div className="flex gap-2">
        <SubmitButton pendingText="Salvando…">{rule ? "Salvar alterações" : "Criar regra"}</SubmitButton>
        {rule && (
          <Button type="button" variant="ghost" onClick={done}>
            Cancelar
          </Button>
        )}
      </div>
    </ActionForm>
  );
}
