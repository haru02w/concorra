import { z } from "zod";

export const markReadSchema = z.object({ ids: z.union([z.literal("all"), z.array(z.string())]) });
