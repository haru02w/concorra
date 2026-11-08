import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";
import type { Analysis } from "@/modules/shared/ports";
import type { Citation, Cited, NoticeExtraction } from "@/domain/analysis/extraction";
import { DOCUMENT_KIND_LABELS } from "@/domain/documents/document";
import { noticeLink, type NoticeFile } from "@/domain/notice/notice";
import { formatCnpj } from "@/domain/shared/cnpj";
import { parsePncpDateTime } from "@/domain/shared/dates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AutoRefresh } from "@/web/components/auto-refresh";
import { formatDateTime, formatMoney } from "@/web/components/format";
import { StatusBadge } from "@/web/components/status-badge";
import { getServices } from "@/web/server/container";
import { orNotFound } from "@/web/server/page";
import { requireActor } from "@/web/server/session";
import { AnalyzeButton, DecisionForms } from "./forms";

export const metadata = { title: "Licitação" };

const RUNNING = ["queued", "ingesting", "running"];

export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  const services = getServices();
  const { notice, items, files } = await orNotFound(services.notices.openNotice(actor, id));
  const [analysis, bid] = await Promise.all([services.analysis.findLatestAnalysis(actor, notice.id), services.bids.findBidForNotice(actor, notice.id)]);
  const pncpUrl = `https://pncp.gov.br/app/editais/${notice.orgaoCnpj}/${notice.ano}/${notice.sequencial}`;

  return (
    <div className="space-y-6">
      <AutoRefresh active={!!analysis && RUNNING.includes(analysis.status)} />
      <div className="space-y-2">
        <Link href="/radar" className="text-sm text-muted-foreground hover:underline">
          ← Radar
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{notice.objeto}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{notice.modalidadeNome}</Badge>
          {notice.situacao && <Badge variant="secondary">{notice.situacao}</Badge>}
          {notice.modoDisputa && <Badge variant="outline">Disputa: {notice.modoDisputa}</Badge>}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Órgão">
            {notice.orgaoNome} <span className="text-muted-foreground">({formatCnpj(notice.orgaoCnpj)})</span>
          </Field>
          <Field label="Unidade">{notice.unidadeNome ?? "—"}</Field>
          <Field label="Local">
            {notice.municipioNome ?? "—"}/{notice.uf ?? "—"}
          </Field>
          <Field label="Número / processo">
            {notice.numeroCompra ?? "—"} · {notice.processo ?? "—"}
          </Field>
          <Field label="Valor estimado">{formatMoney(notice.valorEstimado)}</Field>
          <Field label="Publicação">{formatDateTime(notice.dataPublicacao)}</Field>
          <Field label="Abertura das propostas">{formatDateTime(notice.dataAbertura)}</Field>
          <Field label="Encerramento das propostas">{formatDateTime(notice.dataEncerramento)}</Field>
          <Field label="Controle PNCP">{notice.numeroControlePNCP}</Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={noticeLink(notice)} target="_blank" rel="noreferrer" />}>
              <ExternalLinkIcon /> Portal da licitação
            </Button>
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={pncpUrl} target="_blank" rel="noreferrer" />}>
              <ExternalLinkIcon /> Página no PNCP
            </Button>
          </div>
          {notice.informacaoComplementar && (
            <p className="text-muted-foreground sm:col-span-2 lg:col-span-3">{notice.informacaoComplementar}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decisão</CardTitle>
          <CardDescription>Ao participar, a IA prepara o pacote de documentos e os prazos vão para o seu calendário.</CardDescription>
        </CardHeader>
        <CardContent>
          {bid ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusBadge status={bid.status} />
              {bid.skipReason && <span className="text-muted-foreground">Motivo: {bid.skipReason}</span>}
              {bid.status === "skipped" || bid.status === "cancelled" ? (
                <DecisionForms noticeId={notice.id} />
              ) : (
                <Button size="sm" nativeButton={false} render={<Link href={`/bids/${bid.id}`} />}>
                  Abrir licitação
                </Button>
              )}
            </div>
          ) : (
            <DecisionForms noticeId={notice.id} />
          )}
        </CardContent>
      </Card>

      <AnalysisPanel noticeId={notice.id} analysis={analysis} files={files} />

      <Card>
        <CardHeader>
          <CardTitle>Itens ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead>Unid.</TableHead>
                  <TableHead className="text-right">Valor unit. estimado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.numeroItem}>
                    <TableCell>{i.numeroItem}</TableCell>
                    <TableCell className="max-w-md whitespace-normal">{i.descricao}</TableCell>
                    <TableCell className="text-right">{i.quantidade?.toLocaleString("pt-BR") ?? "—"}</TableCell>
                    <TableCell>{i.unidade ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatMoney(i.valorUnitario)}</TableCell>
                    <TableCell className="text-right">{formatMoney(i.valorTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Itens não disponíveis no PNCP.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Arquivos do edital ({files.length})</CardTitle>
          <CardDescription>{notice.filesIngestedAt ? "Arquivos lidos pela IA." : "Os arquivos são baixados e lidos em segundo plano."}</CardDescription>
        </CardHeader>
        <CardContent>
          {files.length ? (
            <ul className="divide-y text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{f.titulo}</span>
                  {f.tipo && <Badge variant="outline">{f.tipo}</Badge>}
                  {f.pageCount !== null && <span className="text-muted-foreground">{f.pageCount} pág.</span>}
                  {f.ocr && <Badge variant="secondary">OCR</Badge>}
                  <a href={f.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:underline">
                    Original <ExternalLinkIcon className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{notice.filesIngestedAt ? "Nenhum arquivo publicado." : "Buscando arquivos no PNCP…"}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  queued: "Análise na fila…",
  ingesting: "Baixando e lendo os arquivos do edital…",
  running: "A IA está analisando o edital…",
};

function AnalysisPanel({ noticeId, analysis, files }: { noticeId: string; analysis: Analysis | null; files: NoticeFile[] }) {
  const fileName = (fileId: string) => (fileId === "pncp-metadata" ? "Dados do PNCP" : (files.find((f) => f.id === fileId)?.titulo ?? "arquivo"));

  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Análise com IA</CardTitle>
          <CardDescription>
            Extrai prazos, exigências de habilitação e riscos do edital, com citações verificadas, e calcula a aderência à sua empresa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnalyzeButton noticeId={noticeId} />
        </CardContent>
      </Card>
    );
  }

  if (RUNNING.includes(analysis.status)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Análise com IA <StatusBadge status={analysis.status} />
          </CardTitle>
          <CardDescription>{STATUS_TEXT[analysis.status]} Esta página atualiza sozinha.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (analysis.status === "failed" || !analysis.extraction) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Análise com IA <StatusBadge status="failed" />
          </CardTitle>
          <CardDescription>{analysis.error ?? "A análise não pôde ser concluída."}</CardDescription>
        </CardHeader>
        <CardContent>
          <AnalyzeButton noticeId={noticeId} force label="Tentar novamente" />
        </CardContent>
      </Card>
    );
  }

  const x = analysis.extraction;
  const gaps = new Map((analysis.gaps ?? []).map((g) => [g.requirementId, g]));
  const report = analysis.citationReport;

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>Análise assistida por IA — confira sempre o edital.</AlertTitle>
        <AlertDescription>
          {report ? `${report.verifiedCount} de ${report.total} citações verificadas no texto do edital.` : null} Modelo: {analysis.model ?? "—"} ·{" "}
          {formatDateTime(analysis.createdAt)}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Aderência</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-semibold tabular-nums">{analysis.score ?? "—"}</span>
              <span className="text-muted-foreground">/100</span>
            </div>
            <StatusBadge status={analysis.recommendation} />
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {(analysis.recommendationReasons ?? []).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="pt-1">
              <AnalyzeButton noticeId={noticeId} force label="Refazer análise" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Fatores do score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(analysis.scoreFactors ?? []).map((f) => (
              <div key={f.key} className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span>
                    {f.label} <span className="text-xs text-muted-foreground">(peso {Math.round(f.weight * 100)}%)</span>
                  </span>
                  <span className="text-muted-foreground">{f.detail}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(f.value * 100)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {x.risks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Riscos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {x.risks.map((r, i) => (
              <div key={i} className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={r.severity === "high" ? "destructive" : r.severity === "medium" ? "secondary" : "outline"}>
                    {r.severity === "high" ? "Alto" : r.severity === "medium" ? "Médio" : "Baixo"}
                  </Badge>
                  <span className="font-medium">{r.title}</span>
                </div>
                <p className="text-muted-foreground">{r.detail}</p>
                <Quote citation={r.citation} fileName={fileName} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Prazos e condições</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <CitedField label="Objeto" cited={x.objeto} fileName={fileName} />
          <CitedField label="Impugnação até" cited={x.dates.impugnacao} fileName={fileName} date />
          <CitedField label="Esclarecimentos até" cited={x.dates.esclarecimentos} fileName={fileName} date />
          <CitedField label="Abertura" cited={x.dates.abertura} fileName={fileName} date />
          <CitedField label="Sessão pública" cited={x.dates.sessao} fileName={fileName} date />
          <CitedField label="Exclusiva ME/EPP" cited={x.meEppExclusive} fileName={fileName} />
          <CitedField label="Garantia" cited={x.guarantee} fileName={fileName} />
          <CitedField label="Visita técnica" cited={x.visitaTecnica} fileName={fileName} />
          <CitedField label="Amostras" cited={x.samples} fileName={fileName} />
          <CitedField label="Penalidades" cited={x.penalties} fileName={fileName} />
          <div className="text-sm">
            <div className="text-xs text-muted-foreground">Portal de envio</div>
            <div>{x.submissionPortal ?? "—"}</div>
          </div>
          {x.lots.length > 0 && (
            <div className="text-sm md:col-span-2">
              <div className="text-xs text-muted-foreground">Lotes</div>
              <ul className="list-inside list-disc">
                {x.lots.map((l) => (
                  <li key={l.number}>
                    Lote {l.number}: {l.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Habilitação ({x.requirements.length})</CardTitle>
          <CardDescription>Cada exigência comparada com os documentos do seu cofre.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {x.requirements.map((r) => {
              const gap = gaps.get(r.id);
              return (
                <li key={r.id} className="space-y-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {gap && <StatusBadge status={gap.status} />}
                    <span className="font-medium">{r.description}</span>
                    <Badge variant="outline">{CATEGORY_LABELS[r.category] ?? r.category}</Badge>
                    {r.documentKind && <span className="text-xs text-muted-foreground">{DOCUMENT_KIND_LABELS[r.documentKind]}</span>}
                    <VerifiedBadge verified={r.verified} />
                  </div>
                  {gap && <p className="text-xs text-muted-foreground">{gap.note}</p>}
                  <Quote citation={r.citation} fileName={fileName} />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {(x.declarations.length > 0 || x.annexModels.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Declarações e modelos exigidos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {x.declarations.map((d) => (
              <div key={d.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.title}</span>
                  <VerifiedBadge verified={d.verified} />
                </div>
                <p className="text-muted-foreground">{d.description}</p>
                <Quote citation={d.citation} fileName={fileName} />
              </div>
            ))}
            {x.annexModels.map((a) => (
              <div key={a.title}>
                <span className="font-medium">{a.title}</span> <span className="text-muted-foreground">— {a.description}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  juridica: "Jurídica",
  fiscal_trabalhista: "Fiscal e trabalhista",
  economico_financeira: "Econômico-financeira",
  tecnica: "Técnica",
  outra: "Outra",
};

function VerifiedBadge({ verified }: { verified?: boolean }) {
  if (verified === undefined) return null;
  return verified ? <Badge variant="secondary">verificado</Badge> : <Badge variant="destructive">não verificado</Badge>;
}

function Quote({ citation, fileName }: { citation: Citation | null; fileName: (id: string) => string }) {
  if (!citation) return null;
  return (
    <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground">
      “{citation.excerpt}” — {fileName(citation.fileId)}, p. {citation.page}
    </blockquote>
  );
}

function display(value: unknown, date: boolean): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (date && typeof value === "string") return formatDateTime(parsePncpDateTime(value)) || value;
  return String(value);
}

function CitedField({
  label,
  cited,
  fileName,
  date = false,
}: {
  label: string;
  cited: Cited<unknown> | NoticeExtraction["objeto"];
  fileName: (id: string) => string;
  date?: boolean;
}) {
  const empty = cited.value === null || cited.value === "";
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {label}
        {!empty && <VerifiedBadge verified={cited.verified} />}
      </div>
      <div>{display(cited.value, date)}</div>
      {!empty && <Quote citation={cited.citation} fileName={fileName} />}
    </div>
  );
}
