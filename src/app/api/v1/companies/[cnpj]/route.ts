import { lookupCompany } from "@/application/use-cases/organizations";
import { notFound, withSession } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** BrasilAPI CNPJ lookup used to prefill onboarding. */
export const GET = withSession<{ cnpj: string }>(async ({ params }) => {
  const company = await lookupCompany(getDeps(), params.cnpj);
  return company ? { company } : notFound("Company", params.cnpj);
});
