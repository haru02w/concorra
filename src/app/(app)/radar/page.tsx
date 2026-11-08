import Link from "next/link";
import { MODALIDADES, UFS, type Notice } from "@/domain/notice/notice";
import { searchNotices } from "@/application/use-cases/radar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { daysUntil, formatDate, formatMoney } from "@/web/components/format";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";

export const metadata = { title: "Radar" };

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function RadarPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab = param(sp.tab) === "search" ? "search" : "matches";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Radar</h1>
        <p className="text-sm text-muted-foreground">Licitações abertas no PNCP, filtradas pelas suas regras e ordenadas pela afinidade com a sua empresa.</p>
      </div>
      <nav className="flex gap-1 border-b">
        {[
          { key: "matches", label: "Para você", href: "/radar" },
          { key: "search", label: "Buscar", href: "/radar?tab=search" },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.key ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "matches" ? <Matches /> : <Search sp={sp} />}
    </div>
  );
}

function Deadline({ date }: { date: Date | null }) {
  const days = daysUntil(date);
  if (days === null) return <span>—</span>;
  return (
    <span>
      {formatDate(date)}{" "}
      <span className={cn("text-xs", days < 0 ? "text-muted-foreground" : days <= 3 ? "text-destructive" : "text-muted-foreground")}>
        {days < 0 ? "(encerrada)" : days === 0 ? "(hoje)" : `(em ${days} dia${days === 1 ? "" : "s"})`}
      </span>
    </span>
  );
}

function NoticeRow({ notice, extra }: { notice: Notice; extra?: React.ReactNode }) {
  return (
    <Link href={`/radar/${notice.id}`} className="block rounded-xl ring-1 ring-foreground/10 transition-colors hover:bg-muted/40">
      <div className="space-y-2 p-4">
        <div className="line-clamp-2 font-medium">{notice.objeto}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{notice.orgaoNome}</span>
          <span>
            {notice.municipioNome ?? "—"}/{notice.uf ?? "—"}
          </span>
          <span>{notice.modalidadeNome}</span>
          <span>Valor estimado: {formatMoney(notice.valorEstimado)}</span>
          <span>
            Encerramento: <Deadline date={notice.dataEncerramento} />
          </span>
        </div>
        {extra && <div className="flex flex-wrap gap-2">{extra}</div>}
      </div>
    </Link>
  );
}

function Affinity({ similarity }: { similarity: number | null }) {
  if (similarity === null) return null;
  return <Badge variant="secondary">afinidade {Math.round(Math.max(0, similarity) * 100)}%</Badge>;
}

async function Matches() {
  const { actor } = await requireActor();
  const matches = await getDeps().matches.listByOrg(actor.organizationId, 50);
  if (!matches.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nenhuma licitação encontrada ainda</CardTitle>
          <CardDescription>
            Crie regras de notificação com palavras-chave, regiões e faixas de valor, e complete o perfil da empresa para melhorar a afinidade. Novas
            licitações do PNCP são verificadas a cada 10 minutos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button nativeButton={false} render={<Link href="/rules" />}>
            Criar regra
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/company" />}>
            Completar perfil
          </Button>
          <Button variant="ghost" nativeButton={false} render={<Link href="/radar?tab=search" />}>
            Buscar licitações
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {matches.map((m) => (
        <NoticeRow
          key={m.id}
          notice={m.notice}
          extra={
            <>
              <Badge variant="outline">Regra: {m.ruleName}</Badge>
              <Affinity similarity={m.similarity} />
              {m.status === "pending_score" && <Badge variant="secondary">aguardando análise</Badge>}
            </>
          }
        />
      ))}
    </div>
  );
}

const PAGE_SIZE = 20;

async function Search({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const { actor } = await requireActor();
  const query = param(sp.q);
  const uf = param(sp.uf);
  const modalidade = param(sp.modalidade);
  // Checkbox: absent on first visit → default on; the hidden "f" field marks a submitted form.
  const openOnly = param(sp.f) ? param(sp.open) === "1" : true;
  const page = Math.max(1, Number(param(sp.page)) || 1);
  const { rows, total } = await searchNotices(getDeps(), actor, {
    query: query || undefined,
    uf: uf || undefined,
    modalidadeId: modalidade ? Number(modalidade) : undefined,
    openOnly,
    page,
    pageSize: PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const qs = new URLSearchParams({ tab: "search", f: "1", q: query, uf, modalidade, open: openOnly ? "1" : "", page: String(p) });
    return `/radar?${qs}`;
  };

  return (
    <div className="space-y-4">
      <form method="get" className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10 md:grid-cols-[2fr_1fr_1.5fr_auto_auto] md:items-end">
        <input type="hidden" name="tab" value="search" />
        <input type="hidden" name="f" value="1" />
        <div className="space-y-1">
          <Label htmlFor="q">Palavras-chave</Label>
          <Input id="q" name="q" defaultValue={query} placeholder="ex.: material de limpeza" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="uf">UF</Label>
          <select id="uf" name="uf" defaultValue={uf} className={selectClass}>
            <option value="">Todas</option>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="modalidade">Modalidade</Label>
          <select id="modalidade" name="modalidade" defaultValue={modalidade} className={selectClass}>
            <option value="">Todas</option>
            {Object.entries(MODALIDADES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="open" value="1" defaultChecked={openOnly} className="size-4" />
          Somente abertas
        </label>
        <Button type="submit">Buscar</Button>
      </form>

      <p className="text-sm text-muted-foreground">
        {total} licitação(ões) encontrada(s), ordenadas por afinidade com o perfil da empresa.
      </p>

      {rows.length ? (
        <div className="space-y-3">
          {rows.map((n) => (
            <NoticeRow key={n.id} notice={n} extra={<Affinity similarity={n.similarity} />} />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Nada encontrado</CardTitle>
            <CardDescription>Tente outras palavras-chave, remova filtros ou desmarque &quot;Somente abertas&quot;.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <PageLink href={pageHref(page - 1)} disabled={page <= 1}>
            Anterior
          </PageLink>
          <span className="text-muted-foreground">
            Página {page} de {pages}
          </span>
          <PageLink href={pageHref(page + 1)} disabled={page >= pages}>
            Próxima
          </PageLink>
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href} />}>
      {children}
    </Button>
  );
}
