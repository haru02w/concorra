"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm } from "@/web/components/action-form";
import { SubmitButton } from "@/web/components/submit-button";
import { Markdown } from "../markdown";
import { editDocument } from "./actions";

/** Preview + Markdown editor for one generated document. */
export function DocEditor({ bidId, docId, title, markdown, editable }: { bidId: string; docId: string; title: string; markdown: string; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(markdown);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(markdown);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{editable ? "Visualizar / editar" : "Visualizar"}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Campos estruturados (CNPJ, edital, órgão, itens) vêm dos dados; o texto foi redigido por IA. Revise antes de aprovar.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="preview">
          <TabsList>
            <TabsTrigger value="preview">Visualizar</TabsTrigger>
            {editable && <TabsTrigger value="edit">Editar (Markdown)</TabsTrigger>}
          </TabsList>
          <TabsContent value="preview" className="rounded-lg border p-4">
            <Markdown>{draft}</Markdown>
          </TabsContent>
          {editable && (
            <TabsContent value="edit">
              <ActionForm action={editDocument} onSuccess={close} className="space-y-3">
                <input type="hidden" name="bidId" value={bidId} />
                <input type="hidden" name="docId" value={docId} />
                <Textarea name="markdown" value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} className="font-mono text-xs" />
                <div className="flex justify-end">
                  <SubmitButton pendingText="Salvando…">Salvar alterações</SubmitButton>
                </div>
              </ActionForm>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
