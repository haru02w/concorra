import { z } from "zod";
import { EMPTY_FILTERS } from "@/domain/rules/rule";

const strings = z.array(z.string()).default([]);

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
