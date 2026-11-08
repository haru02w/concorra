import type { Metadata } from "next";
import { ExternalLinkIcon, ShieldCheckIcon } from "lucide-react";
import { CERTIDAO_PORTALS, DOCUMENT_KIND_LABELS, DOCUMENT_KINDS, type DocumentKind } from "@/domain/documents/document";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionForm } from "@/web/components/action-form";
import { AutoRefresh } from "@/web/components/auto-refresh";
import { formatDate } from "@/web/components/format";
import { StatusBadge } from "@/web/components/status-badge";
import { SubmitButton } from "@/web/components/submit-button";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { ConfirmSubmit } from "../bids/confirm-submit";
import { remove, upload } from "@/modules/documents/documents.actions";

export const metadata: Metadata = { title: "Documentos" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const { actor } = await requireActor();
  const docs = await getServices().documents.listDocuments(actor);
  const preselected = DOCUMENT_KINDS.includes(kind as DocumentKind) ? kind : "cnd_federal";
  const portals = Object.entries(CERTIDAO_PORTALS) as [DocumentKind, string][];

  return (
    <div className="space-y-6">
      <AutoRefresh active={docs.some((d) => d.status === "pending")} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cofre de documentos</h1>
        <p className="text-sm text-muted-foreground">Certidões, balanço, contrato social e atestados — validados por IA e conferidos contra o CNPJ e a validade.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Enviar documento</CardTitle>
          <CardDescription>PDF, PNG ou JPEG de até 15 MB.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={upload} resetOnSuccess className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="kind">Tipo</Label>
              <select
                id="kind"
                name="kind"
                defaultValue={preselected}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="file">Arquivo</Label>
              <Input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required className="max-w-xs" />
            </div>
            <SubmitButton pendingText="Enviando…">Enviar</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentos da empresa</CardTitle>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento enviado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Emissor</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="max-w-sm whitespace-normal">
                      <div className="font-medium">{DOCUMENT_KIND_LABELS[doc.kind]}</div>
                      <div className="text-xs text-muted-foreground">{doc.fileName}</div>
                      {doc.checks.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {doc.checks.map((c) => (
                            <li key={c.key} className={c.ok ? "text-muted-foreground" : "text-destructive"}>
                              {c.ok ? "✓" : "✗"} {c.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">{doc.issuer ?? "—"}</TableCell>
                    <TableCell>{formatDate(doc.issuedAt)}</TableCell>
                    <TableCell>{formatDate(doc.validUntil)}</TableCell>
                    <TableCell>
                      <StatusBadge status={doc.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-3">
                        <a className="text-sm underline" href={`/api/files/${doc.fileId}`}>
                          Baixar
                        </a>
                        <ActionForm action={remove}>
                          <input type="hidden" name="documentId" value={doc.id} />
                          <ConfirmSubmit variant="ghost" size="sm" message="Excluir este documento? O arquivo será apagado.">
                            Excluir
                          </ConfirmSubmit>
                        </ActionForm>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Onde emitir certidões</CardTitle>
          <CardDescription>Emita no portal oficial e envie o arquivo ao cofre.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {portals.map(([k, url]) => (
              <li key={k}>
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">
                  {DOCUMENT_KIND_LABELS[k]} <ExternalLinkIcon className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>Privacidade (LGPD)</AlertTitle>
        <AlertDescription>
          Os documentos ficam armazenados de forma privada e são processados por provedores de IA de terceiros para extrair dados e validar. Você pode
          excluí-los a qualquer momento.
        </AlertDescription>
      </Alert>
    </div>
  );
}
