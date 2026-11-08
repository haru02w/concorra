import { WorkOS } from "@workos-inc/node";
import type { PgBoss } from "pg-boss";
import type { Deps, PaymentGateway } from "@/application/ports";
import { createGeminiAiGateway } from "./ai/gemini-gateway";
import { JsZipArchiver } from "./archive/jszip-archiver";
import { BrasilApiCompanyLookup } from "./brasilapi/brasilapi";
import { GoogleCalendarProvider } from "./calendar/google";
import { MicrosoftCalendarProvider } from "./calendar/microsoft";
import { loadEnv, type Env } from "./config/env";
import { AesGcmCipher } from "./crypto/aes-cipher";
import { createPrisma, type Db } from "./db/client";
import { createRepositories } from "./db/repositories";
import { ConsoleMailer, ResendMailer } from "./email/resend-mailer";
import { WorkOsIdentityProvider } from "./identity/workos-identity";
import { createBoss, PgBossJobQueue } from "./jobs/pgboss-queue";
import { AbacatePayGateway } from "./payments/abacatepay";
import { UnpdfTextExtractor } from "./pdf/unpdf-extractor";
import { PncpHttpGateway } from "./pncp/pncp-gateway";
import { PandocRenderer } from "./render/pandoc-renderer";
import { S3FileStorage } from "./storage/s3-storage";
import { createMockFetch } from "./mock/mock-fetch";
import { MockOutbox, mockResendClient, mockWorkOsClient } from "./mock/outbox";

/** Placeholder for an integration whose env vars are missing: fails loudly when used. */
export function unconfigured<T extends object>(name: string, envVars: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      return () => {
        throw new Error(`${name} is not configured (set ${envVars})`);
      };
    },
  });
}

/** Webhook secret AbacatePay (or its mock) sends in `?webhookSecret=`. */
export function paymentWebhookSecret(env: Env): string {
  return env.ABACATEPAY_WEBHOOK_SECRET ?? "mock-webhook-secret";
}

export interface Container {
  env: Env;
  /** Set when MOCK_EXTERNAL=true. */
  outbox: MockOutbox | null;
  db: Db;
  boss: PgBoss;
  jobs: PgBossJobQueue;
  storage: S3FileStorage;
  deps: Deps;
}

export function createContainer(role: "web" | "worker", env: Env = loadEnv()): Container {
  const db = createPrisma(env.DATABASE_URL);
  const boss = createBoss(env.DATABASE_URL, role);
  const jobs = new PgBossJobQueue(boss);
  const storage = new S3FileStorage({
    bucket: env.S3_BUCKET,
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  const cipher = new AesGcmCipher(env.APP_SECRET);
  const pdfText = new UnpdfTextExtractor();

  // MOCK_EXTERNAL: real adapters, fake network (see infrastructure/mock).
  const mock = env.MOCK_EXTERNAL;
  const outbox = mock ? new MockOutbox(db) : null;
  const mockFetch = outbox ? createMockFetch({ appUrl: env.APP_URL, outbox, pdfText }) : undefined;

  const geminiModels = {
    ...(env.GEMINI_MODEL_EXTRACT && { extract: env.GEMINI_MODEL_EXTRACT }),
    ...(env.GEMINI_MODEL_CLASSIFY && { classify: env.GEMINI_MODEL_CLASSIFY }),
    ...(env.GEMINI_MODEL_DRAFT && { draft: env.GEMINI_MODEL_DRAFT }),
    ...(env.GEMINI_MODEL_VERIFY && { verify: env.GEMINI_MODEL_VERIFY }),
    ...(env.GEMINI_MODEL_OCR && { ocr: env.GEMINI_MODEL_OCR }),
    ...(env.GEMINI_MODEL_EMBED && { embed: env.GEMINI_MODEL_EMBED }),
  };
  const ai =
    mock || env.GEMINI_API_KEY
      ? createGeminiAiGateway({ apiKey: mock ? "mock-gemini-key" : env.GEMINI_API_KEY!, models: geminiModels, fetch: mockFetch })
      : unconfigured<Deps["ai"]>("Gemini", "GEMINI_API_KEY");

  const payments: PaymentGateway = mock
    ? new AbacatePayGateway({
        apiKey: "mock-abacatepay-key",
        webhookSecret: paymentWebhookSecret(env),
        productIds: { pro: "prod_mock_concorra-pro", business: "prod_mock_concorra-business" },
        fetch: mockFetch,
      })
    : env.ABACATEPAY_API_KEY && env.ABACATEPAY_WEBHOOK_SECRET && env.ABACATEPAY_PRODUCT_PRO && env.ABACATEPAY_PRODUCT_BUSINESS
      ? new AbacatePayGateway({
          apiKey: env.ABACATEPAY_API_KEY,
          webhookSecret: env.ABACATEPAY_WEBHOOK_SECRET,
          productIds: { pro: env.ABACATEPAY_PRODUCT_PRO, business: env.ABACATEPAY_PRODUCT_BUSINESS },
        })
      : unconfigured<PaymentGateway>("AbacatePay", "ABACATEPAY_API_KEY, ABACATEPAY_WEBHOOK_SECRET, ABACATEPAY_PRODUCT_PRO/BUSINESS");

  const redirect = (provider: string) => `${env.APP_URL}/api/calendar/${provider}/callback`;
  const oauth = (provider: string, id?: string, secret?: string) =>
    mock ? { clientId: `mock-${provider}-client`, clientSecret: "mock-secret", redirectUri: redirect(provider), fetch: mockFetch } : id && secret ? { clientId: id, clientSecret: secret, redirectUri: redirect(provider) } : null;
  const google = oauth("google", env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  const microsoft = oauth("microsoft", env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET);
  const calendarProviders: Deps["calendarProviders"] = {
    google: google ? new GoogleCalendarProvider(google) : unconfigured("Google Calendar", "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET"),
    microsoft: microsoft ? new MicrosoftCalendarProvider(microsoft) : unconfigured("Microsoft Calendar", "MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET"),
  };

  const roleSlugs = { owner: env.WORKOS_ROLE_OWNER, member: env.WORKOS_ROLE_MEMBER };
  const identity = outbox
    ? new WorkOsIdentityProvider(mockWorkOsClient(outbox), { roleSlugs })
    : env.WORKOS_API_KEY && env.WORKOS_CLIENT_ID
      ? new WorkOsIdentityProvider(new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID }), { roleSlugs })
      : unconfigured<Deps["identity"]>("WorkOS", "WORKOS_API_KEY, WORKOS_CLIENT_ID");

  const mailer = outbox
    ? new ResendMailer({ apiKey: "mock-resend-key", from: env.EMAIL_FROM }, mockResendClient(outbox))
    : env.RESEND_API_KEY
      ? new ResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
      : new ConsoleMailer();

  const deps: Deps = {
    config: { appUrl: env.APP_URL, demoMode: env.DEMO_MODE, emailFrom: env.EMAIL_FROM },
    clock: { now: () => new Date() },
    ...createRepositories(db),
    pncp: new PncpHttpGateway(mockFetch ? { fetch: mockFetch, minGapMs: 0 } : {}),
    companyLookup: new BrasilApiCompanyLookup({ fetch: mockFetch }),
    ai,
    storage,
    pdfText,
    mailer,
    jobs,
    renderer: new PandocRenderer({ bin: env.PANDOC_BIN, concurrency: env.WORKER_CONCURRENCY }),
    archiver: new JsZipArchiver(),
    calendarProviders,
    cipher,
    payments,
    identity,
  };
  return { env, outbox, db, boss, jobs, storage, deps };
}
