import { z } from "zod";
import { DOCUMENT_KINDS } from "@/domain/documents/document";

export const documentKindSchema = z.enum(DOCUMENT_KINDS);
