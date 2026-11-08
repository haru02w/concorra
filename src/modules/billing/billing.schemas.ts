import { z } from "zod";

export const checkoutSchema = z.object({ planId: z.enum(["pro", "business"]) });
