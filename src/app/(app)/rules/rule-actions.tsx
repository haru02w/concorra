"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/web/components/action-form";
import { SubmitButton } from "@/web/components/submit-button";
import { deleteRuleAction, toggleRuleAction } from "@/modules/rules/rules.actions";

export function RuleActions({ id, active }: { id: string; active: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionForm action={toggleRuleAction}>
        <input type="hidden" name="id" value={id} />
        <SubmitButton size="sm" variant="outline">
          {active ? "Desativar" : "Ativar"}
        </SubmitButton>
      </ActionForm>
      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/rules?edit=${id}`} />}>
        Editar
      </Button>
      <ActionForm action={deleteRuleAction}>
        <input type="hidden" name="id" value={id} />
        <SubmitButton
          size="sm"
          variant="destructive"
          onClick={(e) => {
            if (!confirm("Excluir esta regra?")) e.preventDefault();
          }}
        >
          Excluir
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
