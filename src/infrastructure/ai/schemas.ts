import { z } from "zod";
import { DOCUMENT_KINDS } from "@/domain/documents/document";

/** Zod mirrors of the domain types the LLM must produce (structured output only). */

export const citationSchema = z
  .object({
    fileId: z.string().describe("fileId da tag <page> onde o trecho aparece"),
    page: z.number().int().min(1).describe("número n da tag <page>"),
    // No hard max: an over-long excerpt still verifies, a schema failure would lose the whole extraction.
    excerpt: z.string().describe("trecho copiado literalmente do edital, até 300 caracteres"),
  })
  .nullable();

const cited = <T extends z.ZodType>(value: T) => z.object({ value, citation: citationSchema });

const localDateTime = z
  .string()
  .describe("data/hora local de Brasília, formato YYYY-MM-DDTHH:mm:ss");

const documentKind = z.enum(DOCUMENT_KINDS).nullable();

export const noticeExtractionSchema = z.object({
  objeto: cited(z.string()),
  lots: z.array(z.object({ number: z.string(), description: z.string() })),
  dates: z.object({
    impugnacao: cited(localDateTime.nullable()),
    esclarecimentos: cited(localDateTime.nullable()),
    abertura: cited(localDateTime.nullable()),
    sessao: cited(localDateTime.nullable()),
  }),
  requirements: z.array(
    z.object({
      id: z.string().describe('identificador curto e único, ex.: "r1"'),
      category: z.enum(["juridica", "fiscal_trabalhista", "economico_financeira", "tecnica", "outra"]),
      description: z.string(),
      documentKind,
      citation: citationSchema,
    }),
  ),
  declarations: z.array(
    z.object({
      id: z.string().describe('identificador curto e único, ex.: "d1"'),
      title: z.string(),
      description: z.string(),
      citation: citationSchema,
    }),
  ),
  annexModels: z.array(z.object({ title: z.string(), description: z.string() })),
  meEppExclusive: cited(z.boolean().nullable()),
  guarantee: cited(z.string().nullable()),
  visitaTecnica: cited(z.string().nullable()),
  samples: cited(z.string().nullable()),
  penalties: cited(z.string().nullable()),
  risks: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      citation: citationSchema,
    }),
  ),
  submissionPortal: z.string().nullable().describe("sistema eletrônico onde a proposta é enviada, ex.: Compras.gov.br"),
});

export const cnaeSchema = z.object({ compatible: z.boolean(), reason: z.string() });

export const documentExtractionSchema = z.object({
  kind: documentKind,
  issuer: z.string().nullable(),
  cnpj: z.string().nullable().describe("CNPJ a que o documento se refere"),
  issuedAt: z.string().nullable().describe("data de emissão YYYY-MM-DD"),
  validUntil: z.string().nullable().describe("data de validade YYYY-MM-DD"),
});

export const experienceExtractionSchema = z.object({
  issuer: z.string().nullable(),
  object: z.string(),
  quantities: z.string().nullable(),
  periodStart: z.string().nullable().describe("YYYY-MM-DD"),
  periodEnd: z.string().nullable().describe("YYYY-MM-DD"),
});

export const verificationSchema = z.object({
  issues: z.array(z.object({ severity: z.enum(["error", "warning"]), message: z.string() })),
});

export function draftSchema(slots: string[]) {
  return z.object(Object.fromEntries(slots.map((slot) => [slot, z.string()])) as Record<string, z.ZodString>);
}
