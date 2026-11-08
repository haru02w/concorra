import { withSession } from "@/web/server/api";

export const GET = withSession(async ({ session }) => ({
  user: session.user,
  organization: session.organization,
  role: session.actor?.role ?? null,
  organizations: session.organizations.map((o) => ({ id: o.organization.id, razaoSocial: o.organization.razaoSocial, cnpj: o.organization.cnpj, role: o.role })),
  session: { kind: session.kind, demo: session.demo },
}));
