import { z } from "zod";
import { DOCUMENT_KINDS } from "@/domain/documents/document";
import { EMPTY_FILTERS } from "@/domain/rules/rule";

const strings = z.array(z.string()).default([]);

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

export const ruleSchema = z.object({
  name: z.string(),
  filters: z
    .object({
      keywordsInclude: strings,
      keywordsExclude: strings,
      ufs: strings,
      municipiosIbge: strings,
      modalidadeIds: z.array(z.number().int()).default([]),
      orgaoCnpjs: strings,
      valueMin: z.number().nullable().default(null),
      valueMax: z.number().nullable().default(null),
    })
    .default(EMPTY_FILTERS),
  semanticThreshold: z.number().min(0).max(1).nullable().default(null),
  minScore: z.number().int().min(0).max(100).nullable().default(null),
  channels: z.array(z.enum(["email", "inapp"])).default(["email", "inapp"]),
  frequency: z.enum(["immediate", "daily"]).default("immediate"),
  active: z.boolean().default(true),
});

export const experienceSchema = z.object({
  object: z.string(),
  issuer: z.string().nullable().default(null),
  quantities: z.string().nullable().default(null),
  periodStart: z.coerce.date().nullable().default(null),
  periodEnd: z.coerce.date().nullable().default(null),
});

export const documentKindSchema = z.enum(DOCUMENT_KINDS);
