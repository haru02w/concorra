import Link from "next/link";
import { BellIcon } from "lucide-react";
import { PLANS } from "@/domain/billing/plans";
import { formatCnpj } from "@/domain/shared/cnpj";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDeps } from "@/web/server/container";
import { requireActor } from "@/web/server/session";
import { NavLinks } from "./nav-links";
import { OrgSwitcher } from "./org-switcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor, session } = await requireActor();
  const unread = await getDeps().notifications.countUnread(actor.organizationId, actor.userId);
  const org = session.organization!;
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/30 p-4 md:flex">
        <Link href="/radar" className="mb-6 text-lg font-semibold tracking-tight">
          Concorra
        </Link>
        <NavLinks />
        <div className="mt-auto space-y-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{org.razaoSocial}</div>
          <div>{formatCnpj(org.cnpj)}</div>
          <Badge variant="outline">Plano {PLANS[org.planId].name}</Badge>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4">
          <div className="md:hidden">
            <NavLinks compact />
          </div>
          {session.demo && <Badge variant="secondary">Demonstração — dados fictícios</Badge>}
          <div className="ml-auto flex items-center gap-2">
            <OrgSwitcher
              current={org.id}
              organizations={session.organizations.map((o) => ({ id: o.organization.id, name: o.organization.razaoSocial }))}
              disabled={session.demo}
            />
            <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/notifications" aria-label="Notificações" />}>
              <span className="relative">
                <BellIcon />
                {unread > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive px-1 text-[10px] leading-4 text-white">{unread}</span>
                )}
              </span>
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">{session.user.email}</span>
            <form action="/sign-out" method="post">
              <Button variant="outline" size="sm" type="submit">
                Sair
              </Button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
