import { z } from "zod";

export const profileSchema = z
  .object({
    razaoSocial: z.string().min(1),
    nomeFantasia: z.string().nullable(),
    porte: z.enum(["ME", "EPP", "DEMAIS"]),
    cnaePrincipal: z.string().nullable(),
    cnaesSecundarios: z.array(z.string()),
    endereco: z.string().nullable(),
    representante: z.string().nullable(),
    ufs: z.array(z.string().length(2)),
    municipios: z.array(z.string()),
    valueMin: z.number().nonnegative().nullable(),
    valueMax: z.number().nonnegative().nullable(),
    expertiseText: z.string(),
  })
  .partial();

export const createOrganizationSchema = z.object({
  cnpj: z.string(),
  profile: profileSchema.pick({ razaoSocial: true, nomeFantasia: true, porte: true, expertiseText: true, ufs: true, valueMin: true, valueMax: true, representante: true }).default({}),
});

export const inviteSchema = z.object({ email: z.string(), role: z.enum(["owner", "member"]).default("member") });
