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

export interface Container {
  env: Env;
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

  const ai = env.GEMINI_API_KEY
    ? createGeminiAiGateway({
        apiKey: env.GEMINI_API_KEY,
        models: {
          ...(env.GEMINI_MODEL_EXTRACT && { extract: env.GEMINI_MODEL_EXTRACT }),
          ...(env.GEMINI_MODEL_CLASSIFY && { classify: env.GEMINI_MODEL_CLASSIFY }),
          ...(env.GEMINI_MODEL_DRAFT && { draft: env.GEMINI_MODEL_DRAFT }),
          ...(env.GEMINI_MODEL_VERIFY && { verify: env.GEMINI_MODEL_VERIFY }),
          ...(env.GEMINI_MODEL_OCR && { ocr: env.GEMINI_MODEL_OCR }),
          ...(env.GEMINI_MODEL_EMBED && { embed: env.GEMINI_MODEL_EMBED }),
        },
      })
    : unconfigured<Deps["ai"]>("Gemini", "GEMINI_API_KEY");

  const payments: PaymentGateway =
    env.ABACATEPAY_API_KEY && env.ABACATEPAY_WEBHOOK_SECRET && env.ABACATEPAY_PRODUCT_PRO && env.ABACATEPAY_PRODUCT_BUSINESS
      ? new AbacatePayGateway({
          apiKey: env.ABACATEPAY_API_KEY,
          webhookSecret: env.ABACATEPAY_WEBHOOK_SECRET,
          productIds: { pro: env.ABACATEPAY_PRODUCT_PRO, business: env.ABACATEPAY_PRODUCT_BUSINESS },
        })
      : unconfigured<PaymentGateway>("AbacatePay", "ABACATEPAY_API_KEY, ABACATEPAY_WEBHOOK_SECRET, ABACATEPAY_PRODUCT_PRO/BUSINESS");

  const redirect = (provider: string) => `${env.APP_URL}/api/calendar/${provider}/callback`;
  const calendarProviders: Deps["calendarProviders"] = {
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? new GoogleCalendarProvider({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: redirect("google") })
        : unconfigured("Google Calendar", "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET"),
    microsoft:
      env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
        ? new MicrosoftCalendarProvider({ clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, redirectUri: redirect("microsoft") })
        : unconfigured("Microsoft Calendar", "MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET"),
  };

  const identity =
    env.WORKOS_API_KEY && env.WORKOS_CLIENT_ID
      ? new WorkOsIdentityProvider(new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID }), {
          roleSlugs: { owner: env.WORKOS_ROLE_OWNER, member: env.WORKOS_ROLE_MEMBER },
        })
      : unconfigured<Deps["identity"]>("WorkOS", "WORKOS_API_KEY, WORKOS_CLIENT_ID");

  const deps: Deps = {
    config: { appUrl: env.APP_URL, demoMode: env.DEMO_MODE, emailFrom: env.EMAIL_FROM },
    clock: { now: () => new Date() },
    ...createRepositories(db),
    pncp: new PncpHttpGateway(),
    companyLookup: new BrasilApiCompanyLookup(),
    ai,
    storage,
    pdfText: new UnpdfTextExtractor(),
    mailer: env.RESEND_API_KEY ? new ResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }) : new ConsoleMailer(),
    jobs,
    renderer: new PandocRenderer({ bin: env.PANDOC_BIN, concurrency: env.WORKER_CONCURRENCY }),
    archiver: new JsZipArchiver(),
    calendarProviders,
    cipher,
    payments,
    identity,
  };
  return { env, db, boss, jobs, storage, deps };
}
