import { z } from "zod";

export const decisionSchema = z.object({ decision: z.enum(["participate", "skip"]), reason: z.string().optional() });

/** Unit prices in cents by item number; null clears a price. */
export const pricesSchema = z.object({ prices: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative().nullable()) });

export const statusSchema = z.object({ status: z.enum(["ready", "submitted", "cancelled"]) });

export const markdownSchema = z.object({ markdown: z.string() });
