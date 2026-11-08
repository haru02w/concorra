import { redirect } from "next/navigation";
import { formatCnpj } from "@/domain/shared/cnpj";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/web/server/session";
import { switchAction } from "./actions";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Cadastro da empresa" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.demo) redirect("/radar");
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-4 md:py-12">
      <div>
        <h1 className="text-2xl font-semibold">Cadastre sua empresa</h1>
        <p className="text-muted-foreground">Uma organização corresponde a um CNPJ. Você será o responsável (owner).</p>
      </div>
      {session.organizations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Suas organizações</CardTitle>
            <CardDescription>Entre em uma organização existente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {session.organizations.map(({ organization, role }) => (
              <form key={organization.id} action={switchAction} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <input type="hidden" name="workosOrgId" value={organization.workosOrgId} />
                <div className="text-sm">
                  <div className="font-medium">{organization.razaoSocial}</div>
                  <div className="text-muted-foreground">
                    {formatCnpj(organization.cnpj)} · {role === "owner" ? "Responsável" : "Membro"}
                  </div>
                </div>
                <Button type="submit" size="sm" variant="outline">
                  Entrar
                </Button>
              </form>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Nova organização</CardTitle>
          <CardDescription>Busque pelo CNPJ para preencher os dados automaticamente.</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm />
        </CardContent>
      </Card>
    </main>
  );
}
