"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UFS } from "@/domain/notice/notice";
import { ActionForm } from "@/web/components/action-form";
import { SubmitButton } from "@/web/components/submit-button";
import { createOrganizationAction, lookupAction } from "@/modules/organizations/organizations.actions";

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function OnboardingForm() {
  const [lookup, lookupFormAction, lookingUp] = useActionState(lookupAction, null);
  const data = lookup?.data;
  return (
    <ActionForm action={createOrganizationAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cnpj">CNPJ</Label>
        <div className="flex gap-2">
          <Input id="cnpj" name="cnpj" required placeholder="00.000.000/0000-00" defaultValue={data?.cnpj} />
          <Button type="submit" variant="outline" formAction={lookupFormAction} formNoValidate disabled={lookingUp}>
            {lookingUp ? "Buscando…" : "Buscar dados"}
          </Button>
        </div>
        {lookup?.error && <p className="text-sm text-destructive">{lookup.error}</p>}
        {data && <p className="text-sm text-muted-foreground">Dados preenchidos pela BrasilAPI — revise antes de continuar.</p>}
      </div>

      <div key={data?.cnpj ?? "manual"} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="razaoSocial">Razão social</Label>
          <Input id="razaoSocial" name="razaoSocial" defaultValue={data?.razaoSocial} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nomeFantasia">Nome fantasia</Label>
          <Input id="nomeFantasia" name="nomeFantasia" defaultValue={data?.nomeFantasia ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="porte">Porte</Label>
          <select id="porte" name="porte" className={selectClass} defaultValue={data?.porte ?? "DEMAIS"}>
            <option value="ME">Microempresa (ME)</option>
            <option value="EPP">Empresa de Pequeno Porte (EPP)</option>
            <option value="DEMAIS">Demais</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="representante">Representante legal</Label>
          <Input id="representante" name="representante" defaultValue={data?.representante ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ufs">UFs de interesse</Label>
          <select id="ufs" name="ufs" multiple className={`${selectClass} h-24`} defaultValue={data?.uf ? [data.uf] : []}>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="valueMin">Valor mínimo (R$)</Label>
          <Input id="valueMin" name="valueMin" inputMode="decimal" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="valueMax">Valor máximo (R$)</Label>
          <Input id="valueMax" name="valueMax" inputMode="decimal" />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="expertiseText">Área de atuação</Label>
          <Textarea
            id="expertiseText"
            name="expertiseText"
            rows={4}
            placeholder="Ex.: fornecimento de material de limpeza e higiene para órgãos públicos"
          />
          <p className="text-xs text-muted-foreground">Usamos este texto e suas experiências para encontrar editais compatíveis.</p>
        </div>
      </div>
      <SubmitButton pendingText="Criando…">Criar organização</SubmitButton>
    </ActionForm>
  );
}
