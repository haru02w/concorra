import { createGoogle } from "@ai-sdk/google";
import { embedMany, generateText, JSONParseError, NoObjectGeneratedError, NoOutputGeneratedError, Output, TypeValidationError, type EmbeddingModel, type LanguageModel } from "ai";
import type { z } from "zod";
import type { AiGateway, DocumentExtraction, DraftRequest, ExperienceExtraction, PageText } from "@/modules/shared/ports";
import type { NoticeExtraction } from "@/domain/analysis/extraction";
import type { VerificationIssue } from "@/domain/bid/bid";
import { EMBEDDING_DIMENSIONS } from "@/domain/shared/vector";
import * as P from "./prompts";
import * as S from "./schemas";

export interface GeminiModels {
  extract: LanguageModel;
  classify: LanguageModel;
  draft: LanguageModel;
  verify: LanguageModel;
  ocr: LanguageModel;
  embed: EmbeddingModel;
}

const EMBED_BATCH = 100;

function isSchemaFailure(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error) || TypeValidationError.isInstance(error) || JSONParseError.isInstance(error);
}

export class GeminiAiGateway implements AiGateway {
  readonly modelName: string;
  private readonly models: GeminiModels;

  constructor(options: { models: GeminiModels; modelName: string }) {
    this.models = options.models;
    this.modelName = options.modelName;
  }

  /** Structured output with one retry when the model returns invalid JSON / schema. */
  private async object<T extends z.ZodType>(model: LanguageModel, instructions: string, prompt: string, schema: T): Promise<z.infer<T>> {
    for (let attempt = 0; ; attempt++) {
      try {
        const { output } = await generateText({ model, instructions, prompt, output: Output.object({ schema }) });
        return output as z.infer<T>;
      } catch (error) {
        if (attempt >= 1 || !isSchemaFailure(error)) throw error;
      }
    }
  }

  async embed(texts: string[], purpose: "document" | "query"): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const { embeddings } = await embedMany({
        model: this.models.embed,
        values: texts.slice(i, i + EMBED_BATCH),
        maxParallelCalls: 2,
        providerOptions: {
          google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" },
        },
      });
      out.push(...embeddings);
    }
    return out;
  }

  async extractNotice(input: { pages: PageText[]; retryPaths?: string[]; previous?: NoticeExtraction }): Promise<NoticeExtraction> {
    const retry = input.retryPaths?.length ? { paths: input.retryPaths, previous: input.previous } : undefined;
    return this.object(this.models.extract, P.EXTRACT_INSTRUCTIONS, P.extractPrompt(input.pages, retry), S.noticeExtractionSchema);
  }

  async classifyCnae(input: { objeto: string; cnaes: string[]; expertise: string }): Promise<{ compatible: boolean; reason: string }> {
    return this.object(this.models.classify, P.CLASSIFY_INSTRUCTIONS, P.classifyPrompt(input), S.cnaeSchema);
  }

  async extractDocument(input: { text: string; fileName: string }): Promise<DocumentExtraction> {
    return this.object(this.models.classify, P.DOCUMENT_INSTRUCTIONS, P.wrapDocument(input.text, input.fileName), S.documentExtractionSchema);
  }

  async extractExperience(input: { text: string; fileName: string }): Promise<ExperienceExtraction> {
    return this.object(this.models.classify, P.EXPERIENCE_INSTRUCTIONS, P.wrapDocument(input.text, input.fileName), S.experienceExtractionSchema);
  }

  async ocr(input: { bytes: Uint8Array; mediaType: string }): Promise<string[]> {
    const { text } = await generateText({
      model: this.models.ocr,
      instructions: P.OCR_INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcreva o documento anexo." },
            { type: "file", data: input.bytes, mediaType: input.mediaType },
          ],
        },
      ],
    });
    return text
      .split(new RegExp(`^\\s*${P.PAGE_MARKER.replace(/[<>]/g, "\\$&")}\\s*$`, "m"))
      .map((page) => page.trim())
      .filter(Boolean);
  }

  async draft(input: DraftRequest): Promise<Record<string, string>> {
    if (!input.slots.length) return {};
    return this.object(this.models.draft, P.DRAFT_INSTRUCTIONS, P.draftPrompt(input), S.draftSchema(input.slots));
  }

  async verifyDocument(input: { markdown: string; requirements: string[] }): Promise<VerificationIssue[]> {
    const { issues } = await this.object(this.models.verify, P.VERIFY_INSTRUCTIONS, P.verifyPrompt(input), S.verificationSchema);
    return issues;
  }

  async submissionInstructions(input: Parameters<AiGateway["submissionInstructions"]>[0]): Promise<string> {
    const { text } = await generateText({ model: this.models.draft, instructions: P.INSTRUCTIONS_INSTRUCTIONS, prompt: P.instructionsPrompt(input) });
    return text.trim();
  }
}

export const DEFAULT_GEMINI_MODELS = {
  extract: "gemini-2.5-pro",
  classify: "gemini-2.5-flash",
  draft: "gemini-2.5-pro",
  verify: "gemini-2.5-pro",
  ocr: "gemini-2.5-flash",
  embed: "gemini-embedding-001",
} as const;

export function createGeminiAiGateway(options: { apiKey: string; models?: Partial<Record<keyof GeminiModels, string>>; fetch?: typeof fetch }): GeminiAiGateway {
  const google = createGoogle({ apiKey: options.apiKey, fetch: options.fetch });
  const ids = { ...DEFAULT_GEMINI_MODELS, ...options.models };
  return new GeminiAiGateway({
    modelName: `${ids.extract} / ${ids.draft}`,
    models: {
      extract: google(ids.extract),
      classify: google(ids.classify),
      draft: google(ids.draft),
      verify: google(ids.verify),
      ocr: google(ids.ocr),
      embed: google.embedding(ids.embed),
    },
  });
}
