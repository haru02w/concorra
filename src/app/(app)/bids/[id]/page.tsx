import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CheckCircle2Icon, CircleIcon, DownloadIcon, ExternalLinkIcon, InfoIcon, Loader2Icon } from "lucide-react";
import { PACK_STEPS, type PackStepKey } from "@/domain/bid/bid";
import { DOCUMENT_KIND_LABELS } from "@/domain/documents/document";
import { noticeLink } from "@/application/use-cases/radar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionForm } from "@/web/components/action-form";
import { AutoRefresh } from "@/web/components/auto-refresh";
import { formatCents, formatDate, formatDateTime, formatMoney } from "@/web/components/format";
import { StatusBadge } from "@/web/components/status-badge";
import { SubmitButton } from "@/web/components/submit-button";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { ConfirmSubmit } from "../confirm-submit";
import { Markdown } from "../markdown";
import { approveDocument, cancel, markReady, markSubmitted, savePrices } from "./actions";
import { DocEditor } from "./doc-editor";

export const metadata: Metadata = { title: "Licitação" };

const STEP_LABELS: Record<PackStepKey, string> = {
  checklist: "Checklist de habilitação",
  prices: "Preços de referência",
  drafts: "Redação dos documentos",
  verify: "Verificação",
  render: "DOCX e PDF",
  instructions: "Instruções de envio",
};

const KIND_LABELS: Record<string, string> = {
  declaration: "Declaração",
  proposal: "Proposta",
  cover_letter: "Carta",
  annex: "Anexo",
};

const centsToInput = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

export default async function BidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  const deps = getDeps();
  const bid = await deps.bids.findById(actor.organizationId, id);
  if (!bid) notFound();
  const notice = await deps.notices.findById(bid.noticeId);
  if (!notice) notFound();

  const [checklist, lines, refs, generated] = await Promise.all([
    deps.bids.getChecklist(bid.id),
    deps.bids.getProposalLines(bid.id),
    deps.bids.getPriceReferences(bid.id),
    deps.generatedDocs.listByBid(bid.id),
  ]);
  const vaultFiles = new Map<string, string>();
  for (const gap of checklist) {
    if (!gap.documentId || vaultFiles.has(gap.documentId)) continue;
    const doc = await deps.documents.findById(actor.organizationId, gap.documentId);
    if (doc) vaultFiles.set(gap.documentId, doc.fileId);
  }
  const instructions = generated.find((d) => d.kind === "instructions");
  const docs = generated.filter((d) => d.kind !== "instructions");
  const building = bid.status === "participating" && (bid.packStatus === "building" || bid.packStatus === "idle");
  const editable = bid.status === "participating";

  return (
    <div className="space-y-6">
      <AutoRefresh active={building} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={bid.status} />
          <Badge variant="outline">{notice.modalidadeNome}</Badge>
          {notice.numeroCompra && <Badge variant="outline">Edital {notice.numeroCompra}</Badge>}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{notice.objeto}</h1>
        <p className="text-sm text-muted-foreground">
          {notice.orgaoNome} {notice.municipioNome && `— ${notice.municipioNome}/${notice.uf}`} · Encerramento {formatDateTime(notice.dataEncerramento)} ·
          Valor estimado {formatMoney(notice.valorEstimado)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/radar/${notice.id}`} />}>
            Ver análise do edital
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={noticeLink(notice)} target="_blank" rel="noreferrer" />}>
            Portal da licitação <ExternalLinkIcon />
          </Button>
          <Button size="sm" nativeButton={false} render={<a href={`/api/bids/${bid.id}/zip`} />}>
            <DownloadIcon /> Baixar pacote (.zip)
          </Button>
        </div>
      </div>

      <Alert>
        <InfoIcon />
        <AlertTitle>O Concorra não envia nada ao portal — você revisa, aprova e envia.</AlertTitle>
        <AlertDescription>Os documentos são gerados por IA a partir do edital e dos dados da empresa. Confira tudo antes de enviar.</AlertDescription>
      </Alert>

      {bid.status === "skipped" && bid.skipReason && (
        <Alert>
          <AlertTitle>Motivo do descarte</AlertTitle>
          <AlertDescription>{bid.skipReason}</AlertDescription>
        </Alert>
      )}

      {bid.status !== "skipped" && (
        <Card>
          <CardHeader>
            <CardTitle>Pacote da licitação</CardTitle>
            <CardDescription>
              <StatusBadge status={bid.packStatus} />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="grid gap-2 sm:grid-cols-3">
              {PACK_STEPS.map((step) => {
                const done = bid.packSteps.includes(step);
                const current = building && !done && PACK_STEPS.find((s) => !bid.packSteps.includes(s)) === step;
                return (
                  <li key={step} className="flex items-center gap-2 text-sm">
                    {done ? (
                      <CheckCircle2Icon className="size-4 text-green-600" />
                    ) : current ? (
                      <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <CircleIcon className="size-4 text-muted-foreground" />
                    )}
                    <span className={done ? "" : "text-muted-foreground"}>{STEP_LABELS[step]}</span>
                  </li>
                );
              })}
            </ol>
            {bid.packError && (
              <Alert variant="destructive">
                <AlertTitle>Falha ao gerar o pacote</AlertTitle>
                <AlertDescription>{bid.packError} — o processo será tentado novamente automaticamente.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Checklist de habilitação</CardTitle>
          <CardDescription>Cada exigência do edital ligada a um documento do cofre, validado para a data do certame.</CardDescription>
        </CardHeader>
        <CardContent>
          {checklist.length === 0 ? (
            <p className="text-sm text-muted-foreground">O checklist aparece quando a análise do edital terminar.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exigência</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {checklist.map((gap) => {
                  const fileId = gap.documentId ? vaultFiles.get(gap.documentId) : undefined;
                  return (
                    <TableRow key={gap.requirementId}>
                      <TableCell className="max-w-md whitespace-normal">
                        {gap.description}
                        <span className="block text-xs text-muted-foreground">{gap.note}</span>
                      </TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">{gap.documentKind ? DOCUMENT_KIND_LABELS[gap.documentKind] : "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={gap.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {fileId && gap.status === "have" ? (
                          <a className="text-sm underline" href={`/api/files/${fileId}`}>
                            Baixar
                          </a>
                        ) : gap.documentKind ? (
                          <Link className="text-sm underline" href={`/documents?kind=${gap.documentKind}`}>
                            Enviar documento
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proposta e preços de referência</CardTitle>
          <CardDescription>
            Informe o preço unitário de cada item. As referências vêm de contratos semelhantes no PNCP e nunca são preenchidas automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Os itens aparecem após a etapa de preços de referência.</p>
          ) : (
            <ActionForm action={savePrices} className="space-y-4">
              <input type="hidden" name="bidId" value={bid.id} />
              {lines.map((line) => {
                const itemRefs = refs[line.numeroItem] ?? [];
                const total = line.unitPriceCents === null ? null : Math.round(line.unitPriceCents * line.quantidade);
                return (
                  <div key={line.numeroItem} className="space-y-2 rounded-lg border p-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-60 flex-1">
                        <div className="text-sm font-medium">
                          Item {line.numeroItem} — {line.descricao}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {line.quantidade} {line.unidade ?? "un."} · Total: {formatCents(total)}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        R$
                        <Input
                          name={`price_${line.numeroItem}`}
                          defaultValue={centsToInput(line.unitPriceCents)}
                          placeholder="0,00"
                          inputMode="decimal"
                          className="w-32"
                          disabled={!editable}
                          aria-label={`Preço unitário do item ${line.numeroItem}`}
                        />
                      </label>
                    </div>
                    {itemRefs.length > 0 && (
                      <div className="rounded-md bg-muted/50 p-2">
                        <div className="mb-1 text-xs font-medium text-muted-foreground">Referência — não preenchido automaticamente</div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Descrição</TableHead>
                              <TableHead>Órgão</TableHead>
                              <TableHead>Data</TableHead>
                              <TableHead className="text-right">Valor unit.</TableHead>
                              <TableHead className="text-right">Similaridade</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {itemRefs.map((ref, i) => (
                              <TableRow key={`${ref.numeroControlePNCP}-${i}`}>
                                <TableCell className="max-w-xs whitespace-normal text-xs">{ref.descricao}</TableCell>
                                <TableCell className="text-xs">
                                  {ref.orgaoNome ?? "—"} {ref.uf && `(${ref.uf})`}
                                </TableCell>
                                <TableCell className="text-xs">{formatDate(ref.data)}</TableCell>
                                <TableCell className="text-right text-xs">{formatMoney(ref.valorUnitario)}</TableCell>
                                <TableCell className="text-right text-xs">{Math.round(ref.similarity * 100)}%</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
              {editable && (
                <div className="flex justify-end">
                  <SubmitButton pendingText="Salvando…">Salvar preços</SubmitButton>
                </div>
              )}
            </ActionForm>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentos gerados</CardTitle>
          <CardDescription>Cada documento precisa da sua aprovação antes de a licitação ficar pronta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {docs.length === 0 && <p className="text-sm text-muted-foreground">Os documentos aparecem após a etapa de redação.</p>}
          {docs.map((doc) => {
            const errors = doc.verification.filter((v) => v.severity === "error");
            return (
              <div key={doc.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{doc.title}</span>
                  <Badge variant="outline">{KIND_LABELS[doc.kind] ?? doc.kind}</Badge>
                  <StatusBadge status={doc.status} />
                  <div className="ml-auto flex flex-wrap gap-2">
                    <DocEditor bidId={bid.id} docId={doc.id} title={doc.title} markdown={doc.markdown} editable={editable} />
                    {doc.docxFileId && (
                      <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/files/${doc.docxFileId}`} />}>
                        DOCX
                      </Button>
                    )}
                    {doc.pdfFileId && (
                      <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/files/${doc.pdfFileId}`} />}>
                        PDF
                      </Button>
                    )}
                    {editable && doc.status !== "approved" && (
                      <ActionForm action={approveDocument}>
                        <input type="hidden" name="bidId" value={bid.id} />
                        <input type="hidden" name="docId" value={doc.id} />
                        <SubmitButton size="sm" disabled={errors.length > 0}>
                          Aprovar
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </div>
                {doc.verification.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {doc.verification.map((issue, i) => (
                      <li key={i} className={issue.severity === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>
                        {issue.severity === "error" ? "✗" : "⚠"} {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {instructions && (
        <Card>
          <CardHeader>
            <CardTitle>Instruções de envio</CardTitle>
            <CardDescription>Passo a passo para enviar no portal, gerado a partir do edital.</CardDescription>
          </CardHeader>
          <CardContent>
            <Markdown>{instructions.markdown}</Markdown>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        {bid.status === "participating" && (
          <ActionForm action={markReady}>
            <input type="hidden" name="bidId" value={bid.id} />
            <SubmitButton>Marcar como pronta</SubmitButton>
          </ActionForm>
        )}
        {bid.status === "ready" && (
          <ActionForm action={markSubmitted}>
            <input type="hidden" name="bidId" value={bid.id} />
            <SubmitButton>Marcar como enviada</SubmitButton>
          </ActionForm>
        )}
        {["participating", "ready", "submitted"].includes(bid.status) && (
          <ActionForm action={cancel}>
            <input type="hidden" name="bidId" value={bid.id} />
            <ConfirmSubmit variant="destructive" message="Cancelar a participação? Os eventos de calendário serão removidos.">
              Cancelar participação
            </ConfirmSubmit>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
