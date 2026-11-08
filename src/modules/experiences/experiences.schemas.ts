import { z } from "zod";

export const experienceSchema = z.object({
  object: z.string(),
  issuer: z.string().nullable().default(null),
  quantities: z.string().nullable().default(null),
  periodStart: z.coerce.date().nullable().default(null),
  periodEnd: z.coerce.date().nullable().default(null),
});
