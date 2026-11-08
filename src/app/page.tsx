import Link from "next/link";
import { BellRingIcon, CalendarClockIcon, FileCheckIcon, FileTextIcon, QuoteIcon, RadarIcon } from "lucide-react";
import { formatBrl, PLANS } from "@/domain/billing/plans";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getContainer } from "@/web/server/container";
import { getSession } from "@/web/server/session";

const ERRORS: Record<string, string> = {
  "auth-not-configured": "Login indisponível: WorkOS não está configurado neste ambiente.",
  "demo-not-seeded": "A conta de demonstração ainda não foi criada (rode `pnpm db:seed`).",
};

const STEPS = [
  { title: "Radar PNCP", text: "Lemos todas as contratações publicadas no Portal Nacional de Contratações Públicas." },
  { title: "Análise com citações", text: "A IA extrai prazos e exigências do edital, cada uma com página e trecho verificados." },
  { title: "Pacote de documentos", text: "Declarações, proposta e checklist de habilitação prontos para revisar e enviar." },
  { title: "Prazos na agenda", text: "Esclarecimentos, propostas e sessão pública direto no Google Agenda ou Outlook." },
];

const FEATURES = [
  { icon: RadarIcon, title: "Radar nacional", text: "Todas as UFs e modalidades, com ranking por similaridade com a sua experiência." },
  { icon: BellRingIcon, title: "Regras de notificação", text: "Palavras-chave, região, valor, modalidade e score mínimo — por e-mail ou no app." },
  { icon: QuoteIcon, title: "IA verificada por citações", text: "Cada informação extraída traz o trecho do edital; o que não confere é marcado." },
  { icon: FileCheckIcon, title: "Cofre de documentos", text: "Certidões validadas (CNPJ e validade) e alertas antes do vencimento." },
  { icon: FileTextIcon, title: "Pacote completo", text: "Declarações, proposta comercial, referências de preço e instruções de envio em DOCX e PDF." },
  { icon: CalendarClockIcon, title: "Calendário", text: "Prazos sincronizados com Google Agenda e Outlook, atualizados em retificações." },
];

const limit = (n: number | null) => (n === null ? "Ilimitado" : String(n));

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const session = await getSession().catch(() => null);
  const demo = getContainer().env.DEMO_MODE;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between p-4">
        <span className="text-lg font-semibold tracking-tight">Concorra</span>
        {session ? (
          <Button nativeButton={false} render={<Link href="/radar" />}>Ir para o app</Button>
        ) : (
          <Button variant="outline" nativeButton={false} render={<a href="/sign-in" />}>Entrar</Button>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-20 px-4 py-12">
        {error && ERRORS[error] && (
          <Alert variant="destructive">
            <AlertDescription>{ERRORS[error]}</AlertDescription>
          </Alert>
        )}

        <section className="space-y-6 text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">Licitações certas, documentos prontos.</h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            O Concorra encontra os editais que valem o seu tempo e prepara o trabalho chato: documentos certos, válidos na data certa,
            escritos e verificados por IA.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {session ? (
              <Button size="lg" nativeButton={false} render={<Link href="/radar" />}>Ir para o app</Button>
            ) : (
              <>
                <Button size="lg" nativeButton={false} render={<a href="/sign-in" />}>Entrar</Button>
                {demo && (
                  <Button size="lg" variant="outline" nativeButton={false} render={<a href="/demo" />}>
                    Ver demonstração
                  </Button>
                )}
              </>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Como funciona</h2>
          <ol className="grid gap-4 md:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">{i + 1}</div>
                <div className="font-medium">{step.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Recursos</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <Card key={title}>
                <CardHeader>
                  <Icon className="size-5" />
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{text}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Planos</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {Object.values(PLANS).map((plan) => (
              <Card key={plan.id}>
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription className="text-2xl font-semibold text-foreground">
                    {formatBrl(plan.priceCents)}
                    <span className="text-sm font-normal text-muted-foreground">/mês</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    <li>Membros: {limit(plan.limits.members)}</li>
                    <li>Regras ativas: {limit(plan.limits.rules)}</li>
                    <li>Análises de IA/mês: {limit(plan.limits.analyses)}</li>
                    <li>Pacotes de licitação/mês: {limit(plan.limits.bidPacks)}</li>
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 p-4 text-sm text-muted-foreground md:flex-row md:justify-between">
          <span>Concorra não envia propostas — você revisa e envia. Análises são orientativas.</span>
          <span>Hack Brasil 2026 · Logística &amp; Automação</span>
        </div>
      </footer>
    </div>
  );
}
