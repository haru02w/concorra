import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));
const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Secret for token encryption and demo sessions (≥ 32 chars). */
  APP_SECRET: z.string().min(32),
  DEMO_MODE: bool,
  DEMO_ORG_CNPJ: z.string().default("99000000000159"),
  /** Replace every external API (PNCP, BrasilAPI, Gemini, WorkOS, Resend, AbacatePay, calendars) with deterministic mocks. */
  MOCK_EXTERNAL: bool,

  S3_ENDPOINT: optional,
  S3_PUBLIC_ENDPOINT: optional,
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().default("concorra"),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  GEMINI_API_KEY: optional,
  GEMINI_MODEL_EXTRACT: optional,
  GEMINI_MODEL_CLASSIFY: optional,
  GEMINI_MODEL_DRAFT: optional,
  GEMINI_MODEL_VERIFY: optional,
  GEMINI_MODEL_OCR: optional,
  GEMINI_MODEL_EMBED: optional,

  RESEND_API_KEY: optional,
  RESEND_WEBHOOK_SECRET: optional,
  EMAIL_FROM: z.string().default("Concorra <no-reply@concorra.local>"),

  WORKOS_API_KEY: optional,
  WORKOS_CLIENT_ID: optional,
  WORKOS_WEBHOOK_SECRET: optional,
  WORKOS_ROLE_OWNER: z.string().default("admin"),
  WORKOS_ROLE_MEMBER: z.string().default("member"),

  ABACATEPAY_API_KEY: optional,
  ABACATEPAY_WEBHOOK_SECRET: optional,
  ABACATEPAY_PRODUCT_PRO: optional,
  ABACATEPAY_PRODUCT_BUSINESS: optional,

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  MICROSOFT_CLIENT_ID: optional,
  MICROSOFT_CLIENT_SECRET: optional,

  PANDOC_BIN: z.string().default("pandoc"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),

  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  /** Escape hatch to allow MOCK_EXTERNAL with NODE_ENV=production. */
  MOCK_ALLOW_PRODUCTION: bool,
  /** Next.js build/dev output directory (the e2e suite uses its own). */
  NEXT_DIST_DIR: z.string().default(".next"),

  /** e2e only: run the suite against an already running server. */
  E2E_BASE_URL: optional,
  /** e2e only: port for the server the suite boots. */
  E2E_PORT: z.coerce.number().int().default(3123),
});

/** Variables `next build` needs: it runs without runtime secrets (e.g. in the Docker build). */
const buildSchema = schema.pick({ NEXT_DIST_DIR: true });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (parsed.data.MOCK_EXTERNAL && parsed.data.NODE_ENV === "production" && !parsed.data.MOCK_ALLOW_PRODUCTION) {
    throw new Error("MOCK_EXTERNAL must not run in production (it enables passwordless mock login)");
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Build-time subset of the environment, for next.config.ts. */
export function loadBuildEnv(source: NodeJS.ProcessEnv = process.env): z.infer<typeof buildSchema> {
  return buildSchema.parse(source);
}

/** Real WorkOS AuthKit sessions (disabled in mock mode, which uses local sessions). */
export function workosConfigured(env: Env): boolean {
  return !env.MOCK_EXTERNAL && !!(env.WORKOS_API_KEY && env.WORKOS_CLIENT_ID);
}

/** Cookie-based sessions: the demo login and the mock login. */
export function localSessionsEnabled(env: Env): boolean {
  return env.DEMO_MODE || env.MOCK_EXTERNAL;
}
