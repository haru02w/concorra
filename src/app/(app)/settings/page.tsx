import { formatCnpj } from "@/domain/shared/cnpj";
import { canManage } from "@/domain/organization/organization";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionForm } from "@/web/components/action-form";
import { SubmitButton } from "@/web/components/submit-button";
import { getServices } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { disconnectCalendarAction } from "@/modules/calendar/calendar.actions";
import { deleteOrganizationAction, inviteAction } from "@/modules/organizations/organizations.actions";

export const metadata = { title: "Configurações" };

const PROVIDERS: Record<string, string> = { google: "Google Agenda", microsoft: "Outlook / Microsoft 365" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const { calendar } = await searchParams;
  const { actor, session } = await requireActor();
  const services = getServices();
  const [members, calendars] = await Promise.all([services.organizations.listMembers(actor), services.calendar.listConnections(actor)]);
  const owner = canManage(actor.role);
  const org = session.organization!;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
          <CardDescription>Responsáveis cuidam de plano, membros e integrações; membros cuidam de regras, análises, documentos e licitações.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Papel</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(({ user, role }) => (
                <TableRow key={user.id}>
                  <TableCell>{user.name ?? "—"}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={role === "owner" ? "default" : "outline"}>{role === "owner" ? "Responsável" : "Membro"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {owner && !session.demo && (
            <ActionForm action={inviteAction} resetOnSuccess className="flex flex-wrap items-end gap-2">
              <div className="min-w-60 flex-1 space-y-1.5">
                <Label htmlFor="email">Convidar por e-mail</Label>
                <Input id="email" name="email" type="email" required placeholder="pessoa@empresa.com.br" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Papel</Label>
                <select id="role" name="role" defaultValue="member" className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
                  <option value="member">Membro</option>
                  <option value="owner">Responsável</option>
                </select>
              </div>
              <SubmitButton pendingText="Enviando…">Convidar</SubmitButton>
            </ActionForm>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agendas</CardTitle>
          <CardDescription>Prazos das licitações e vencimentos de documentos são enviados para as agendas conectadas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {calendar === "connected" && (
            <Alert>
              <AlertDescription>Agenda conectada. Os prazos existentes serão sincronizados em instantes.</AlertDescription>
            </Alert>
          )}
          {calendar === "error" && (
            <Alert variant="destructive">
              <AlertDescription>Não foi possível conectar a agenda. Tente novamente.</AlertDescription>
            </Alert>
          )}
          {calendars.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma agenda conectada.</p>
          ) : (
            <ul className="space-y-2">
              {calendars.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span>
                    {PROVIDERS[c.provider]} {c.email && <span className="text-muted-foreground">· {c.email}</span>}
                  </span>
                  <ActionForm action={disconnectCalendarAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Desconectar
                    </Button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<a href="/api/calendar/google/connect" />}>
              Conectar Google Agenda
            </Button>
            <Button variant="outline" nativeButton={false} render={<a href="/api/calendar/microsoft/connect" />}>
              Conectar Outlook
            </Button>
          </div>
        </CardContent>
      </Card>

      {owner && !session.demo && (
        <Card className="ring-1 ring-destructive/40">
          <CardHeader>
            <CardTitle>Excluir dados da organização</CardTitle>
            <CardDescription>
              Remove permanentemente a organização, documentos, análises e licitações (LGPD). Digite o CNPJ {formatCnpj(org.cnpj)} para confirmar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={deleteOrganizationAction} className="flex flex-wrap gap-2">
              <Input name="confirm" required placeholder={formatCnpj(org.cnpj)} className="max-w-60" aria-label="CNPJ" />
              <SubmitButton variant="destructive" pendingText="Excluindo…">
                Excluir definitivamente
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
