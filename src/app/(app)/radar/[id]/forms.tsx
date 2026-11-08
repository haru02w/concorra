"use client";

import { useState } from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm } from "@/web/components/action-form";
import { SubmitButton } from "@/web/components/submit-button";
import { requestAnalysisAction } from "@/modules/analysis/analysis.actions";
import { participateAction, skipAction } from "@/modules/bids/bids.actions";

export function AnalyzeButton({ noticeId, force = false, label = "Analisar com IA" }: { noticeId: string; force?: boolean; label?: string }) {
  return (
    <ActionForm action={requestAnalysisAction}>
      <input type="hidden" name="noticeId" value={noticeId} />
      {force && <input type="hidden" name="force" value="1" />}
      <SubmitButton pendingText="Solicitando…" variant={force ? "outline" : "default"}>
        <SparklesIcon />
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function DecisionForms({ noticeId }: { noticeId: string }) {
  const [skipping, setSkipping] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <ActionForm action={participateAction}>
          <input type="hidden" name="noticeId" value={noticeId} />
          <SubmitButton pendingText="Criando licitação…">Participar</SubmitButton>
        </ActionForm>
        {!skipping && (
          <Button variant="outline" onClick={() => setSkipping(true)}>
            Não participar
          </Button>
        )}
      </div>
      {skipping && (
        <ActionForm action={skipAction} className="space-y-2">
          <input type="hidden" name="noticeId" value={noticeId} />
          <Label htmlFor="reason">Motivo (opcional — ajuda a melhorar as próximas recomendações)</Label>
          <Textarea id="reason" name="reason" rows={2} placeholder="ex.: fora da nossa região de atuação" />
          <div className="flex gap-2">
            <SubmitButton variant="secondary">Confirmar</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setSkipping(false)}>
              Cancelar
            </Button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
