"use client";

import { Button } from "@/components/ui/button";
import { ActionForm } from "@/web/components/action-form";
import { cancelAction } from "./actions";

export function CancelSubscriptionButton() {
  return (
    <ActionForm action={cancelAction}>
      <Button
        type="submit"
        variant="destructive"
        onClick={(e) => {
          if (!confirm("Cancelar a assinatura? A organização volta ao plano Free imediatamente.")) e.preventDefault();
        }}
      >
        Cancelar assinatura
      </Button>
    </ActionForm>
  );
}
