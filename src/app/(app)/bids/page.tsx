import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { StatusBadge } from "@/web/components/status-badge";
import { daysUntil, formatDateTime } from "@/web/components/format";

export const metadata: Metadata = { title: "Licitações" };

const ACTIVE = ["participating", "ready", "submitted"];

export default async function BidsPage() {
  const { actor } = await requireActor();
  const bids = await getDeps().bids.listByOrg(actor.organizationId);
  const active = bids.filter((b) => ACTIVE.includes(b.status));
  const archived = bids.filter((b) => !ACTIVE.includes(b.status));

  const table = (rows: typeof bids, empty: string) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">{empty}</p>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Objeto</TableHead>
            <TableHead>Órgão</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Pacote</TableHead>
            <TableHead>Encerramento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((b) => {
            const days = daysUntil(b.notice.dataEncerramento);
            return (
              <TableRow key={b.id}>
                <TableCell className="max-w-md whitespace-normal">
                  <Link href={`/bids/${b.id}`} className="font-medium hover:underline">
                    {b.notice.objeto.slice(0, 140)}
                  </Link>
                </TableCell>
                <TableCell className="max-w-48 whitespace-normal text-muted-foreground">
                  {b.notice.orgaoNome} {b.notice.uf && `(${b.notice.uf})`}
                </TableCell>
                <TableCell>
                  <StatusBadge status={b.status} />
                </TableCell>
                <TableCell>{b.status === "participating" ? <StatusBadge status={b.packStatus} /> : "—"}</TableCell>
                <TableCell>
                  {formatDateTime(b.notice.dataEncerramento)}
                  {days !== null && days >= 0 && <span className="block text-xs text-muted-foreground">em {days} dia(s)</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Licitações</h1>
        <p className="text-sm text-muted-foreground">Editais em que a empresa decidiu participar ou descartou.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Em andamento</CardTitle>
          <CardDescription>Participando, prontas para envio ou já enviadas.</CardDescription>
        </CardHeader>
        <CardContent>{table(active, "Nenhuma licitação em andamento. Encontre editais no Radar.")}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Descartadas e canceladas</CardTitle>
        </CardHeader>
        <CardContent>{table(archived, "Nada por aqui.")}</CardContent>
      </Card>
    </div>
  );
}
