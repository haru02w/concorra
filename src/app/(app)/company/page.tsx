import { TrashIcon } from "lucide-react";
import { UFS } from "@/domain/notice/notice";
import { formatCnpj } from "@/domain/shared/cnpj";
import { canManage } from "@/domain/organization/organization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionForm } from "@/web/components/action-form";
import { AutoRefresh } from "@/web/components/auto-refresh";
import { formatDate } from "@/web/components/format";
import { SubmitButton } from "@/web/components/submit-button";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { addExperienceAction, deleteExperienceAction, updateProfileAction, uploadExperienceAction } from "./actions";

export const metadata = { title: "Empresa" };

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm disabled:opacity-50";

function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function CompanyPage() {
  const { actor, session } = await requireActor();
  const org = session.organization!;
  const experiences = await getDeps().experiences.listByOrg(org.id);
  const owner = canManage(actor.role);
  const ro = !owner;
  const processing = experiences.some((e) => e.object.startsWith("Processando"));

  return (
    <div className="space-y-6">
      <AutoRefresh active={processing} />
      <div>
        <h1 className="text-2xl font-semibold">Empresa</h1>
        <p className="text-muted-foreground">
          {org.razaoSocial} · {formatCnpj(org.cnpj)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>{owner ? "Estes dados alimentam o radar, a análise e os documentos gerados." : "Somente o responsável pode editar o perfil."}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={updateProfileAction} className="space-y-4">
            <fieldset disabled={ro} className="grid gap-4 md:grid-cols-2">
              <Field label="Razão social" htmlFor="razaoSocial" className="md:col-span-2">
                <Input id="razaoSocial" name="razaoSocial" defaultValue={org.razaoSocial} required />
              </Field>
              <Field label="Nome fantasia" htmlFor="nomeFantasia">
                <Input id="nomeFantasia" name="nomeFantasia" defaultValue={org.nomeFantasia ?? ""} />
              </Field>
              <Field label="Porte" htmlFor="porte" hint="ME/EPP têm os benefícios da LC 123/2006.">
                <select id="porte" name="porte" defaultValue={org.porte} className={selectClass}>
                  <option value="ME">Microempresa (ME)</option>
                  <option value="EPP">Empresa de Pequeno Porte (EPP)</option>
                  <option value="DEMAIS">Demais</option>
                </select>
              </Field>
              <Field label="CNAE principal" htmlFor="cnaePrincipal">
                <Input id="cnaePrincipal" name="cnaePrincipal" defaultValue={org.cnaePrincipal ?? ""} />
              </Field>
              <Field label="Representante legal" htmlFor="representante">
                <Input id="representante" name="representante" defaultValue={org.representante ?? ""} />
              </Field>
              <Field label="CNAEs secundários" htmlFor="cnaesSecundarios" hint="Um por linha." className="md:col-span-2">
                <Textarea id="cnaesSecundarios" name="cnaesSecundarios" rows={3} defaultValue={org.cnaesSecundarios.join("\n")} />
              </Field>
              <Field label="Endereço" htmlFor="endereco" className="md:col-span-2">
                <Input id="endereco" name="endereco" defaultValue={org.endereco ?? ""} />
              </Field>
              <div className="space-y-1.5 md:col-span-2">
                <Label>UFs de interesse</Label>
                <div className="grid grid-cols-6 gap-1 text-sm sm:grid-cols-9">
                  {UFS.map((uf) => (
                    <label key={uf} className="flex items-center gap-1">
                      <input type="checkbox" name="ufs" value={uf} defaultChecked={org.ufs.includes(uf)} />
                      {uf}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Sem seleção = todo o Brasil.</p>
              </div>
              <Field label="Municípios (código IBGE)" htmlFor="municipios" hint="Separe por vírgula." className="md:col-span-2">
                <Input id="municipios" name="municipios" defaultValue={org.municipios.join(", ")} />
              </Field>
              <Field label="Valor mínimo (R$)" htmlFor="valueMin">
                <Input id="valueMin" name="valueMin" inputMode="decimal" defaultValue={org.valueMin ?? ""} />
              </Field>
              <Field label="Valor máximo (R$)" htmlFor="valueMax">
                <Input id="valueMax" name="valueMax" inputMode="decimal" defaultValue={org.valueMax ?? ""} />
              </Field>
              <Field
                label="Área de atuação"
                htmlFor="expertiseText"
                hint="Descreva o que a empresa faz. Junto com as experiências, este texto define a similaridade usada no radar e nas regras."
                className="md:col-span-2"
              >
                <Textarea id="expertiseText" name="expertiseText" rows={4} defaultValue={org.expertiseText} />
              </Field>
            </fieldset>
            {owner && <SubmitButton pendingText="Salvando…">Salvar perfil</SubmitButton>}
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Experiências</CardTitle>
          <CardDescription>Atestados de capacidade técnica e contratos anteriores. A IA extrai objeto, quantidades, emissor e período.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <ActionForm action={uploadExperienceAction} resetOnSuccess className="space-y-3">
              <Field label="Enviar atestado ou contrato (PDF, PNG, JPEG — até 15 MB)" htmlFor="file">
                <Input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
              </Field>
              <SubmitButton pendingText="Enviando…">Enviar</SubmitButton>
            </ActionForm>
            <ActionForm action={addExperienceAction} resetOnSuccess className="space-y-3">
              <Field label="Objeto" htmlFor="object">
                <Input id="object" name="object" required placeholder="Fornecimento de material de limpeza" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Emissor" htmlFor="issuer">
                  <Input id="issuer" name="issuer" />
                </Field>
                <Field label="Quantidades" htmlFor="quantities">
                  <Input id="quantities" name="quantities" />
                </Field>
                <Field label="Início" htmlFor="periodStart">
                  <Input id="periodStart" name="periodStart" type="date" />
                </Field>
                <Field label="Fim" htmlFor="periodEnd">
                  <Input id="periodEnd" name="periodEnd" type="date" />
                </Field>
              </div>
              <SubmitButton variant="outline" pendingText="Adicionando…">
                Adicionar manualmente
              </SubmitButton>
            </ActionForm>
          </div>

          {experiences.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma experiência cadastrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Objeto</TableHead>
                  <TableHead>Emissor</TableHead>
                  <TableHead>Quantidades</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {experiences.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="max-w-md whitespace-normal">{e.object}</TableCell>
                    <TableCell>{e.issuer ?? "—"}</TableCell>
                    <TableCell>{e.quantities ?? "—"}</TableCell>
                    <TableCell>
                      {formatDate(e.periodStart)} – {formatDate(e.periodEnd)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ActionForm action={deleteExperienceAction}>
                        <input type="hidden" name="id" value={e.id} />
                        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Remover">
                          <TrashIcon />
                        </Button>
                      </ActionForm>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
