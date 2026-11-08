import type { PlanId } from "../billing/plans";

export type Porte = "ME" | "EPP" | "DEMAIS";
export type Role = "owner" | "member";

export interface Organization {
  id: string;
  workosOrgId: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  porte: Porte;
  cnaePrincipal: string | null;
  cnaesSecundarios: string[];
  endereco: string | null;
  municipio: string | null;
  uf: string | null;
  representante: string | null;
  ufs: string[];
  municipios: string[];
  valueMin: number | null;
  valueMax: number | null;
  expertiseText: string;
  planId: PlanId;
}

export interface Experience {
  id: string;
  organizationId: string;
  fileId: string | null;
  issuer: string | null;
  object: string;
  quantities: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/** Text that represents what the company does, used for the profile embedding. */
export function profileText(org: Pick<Organization, "razaoSocial" | "expertiseText" | "cnaePrincipal" | "cnaesSecundarios">, experiences: Pick<Experience, "object" | "quantities">[]): string {
  return [
    org.expertiseText,
    org.cnaePrincipal ? `CNAE principal: ${org.cnaePrincipal}` : "",
    org.cnaesSecundarios.length ? `CNAEs secundários: ${org.cnaesSecundarios.join("; ")}` : "",
    ...experiences.map((e) => `Experiência: ${e.object}${e.quantities ? ` (${e.quantities})` : ""}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export function canManage(role: Role): boolean {
  return role === "owner";
}

/** LC 123/2006 benefits apply to ME/EPP. */
export function hasMeEppBenefits(porte: Porte): boolean {
  return porte === "ME" || porte === "EPP";
}

/** Maps BrasilAPI `porte` strings to our enum. */
export function parsePorte(value: string | null | undefined): Porte {
  const v = (value ?? "").toUpperCase();
  if (v.includes("MICRO")) return "ME";
  if (v.includes("PEQUENO")) return "EPP";
  return "DEMAIS";
}
