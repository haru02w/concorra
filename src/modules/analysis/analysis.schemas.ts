import { z } from "zod";

export const requestAnalysisSchema = z.object({ force: z.boolean().default(false) });
