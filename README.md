# Concorra

> Licitações certas, documentos prontos.

Concorra watches Brazilian public procurement on [PNCP](https://pncp.gov.br), tells a company which *editais* are worth its time, and, once the company decides to bid, prepares everything it needs to participate:

- qualification documents checked against the edital,
- declarations and a proposal drafted by AI and verified,
- reference prices from past contracts,
- step-by-step submission instructions,
- deadlines pushed to Google Calendar or Outlook.

Concorra never submits anything. The user reviews, approves and sends the bid.

Hack Brasil 2026 · Track **Logística & Automação** · Full spec: [`docs/SPEC.md`](docs/SPEC.md)

## Features

| | |
|---|---|
| **F1 Onboarding** | WorkOS AuthKit + organizations. CNPJ lookup via BrasilAPI. Profile with CNAEs, regions, value range and porte. Experience (atestados) is extracted by AI and embedded. |
| **F2 Radar** | Scheduled PNCP ingestion for all of Brazil (open notices plus rectifications), with items and embeddings. Edital files are downloaded lazily, text is extracted per page, and scanned PDFs go through Gemini OCR. |
| **F3 Rules** | Keyword include/exclude, UF, município, modalidade, value range, órgão, semantic similarity to the profile and a minimum AI score. Delivered by email and in-app, immediately or as a daily digest. |
| **F4 AI analysis** | Structured extraction where every fact carries a **citation** (file, page, verbatim excerpt). A deterministic validator checks each excerpt against the stored page text; failures are re-extracted once, then marked *unverified*. Also produces an explainable fit score, risks, a document gap list and a recommendation. |
| **F5 Decision** | Participate or skip, with an optional reason. |
| **F6 Vault** | Upload certidões and other documents. AI extracts type, CNPJ and validity; code checks them. Deep links to the issuing portals. Expiry alerts. |
| **F7 Bid pack** | Habilitação checklist, reference prices (never auto-filled), declarations, proposal and cover letter from Markdown templates (code fills data, the LLM fills prose), AI plus deterministic verification, DOCX and PDF via pandoc/LaTeX, submission instructions, and a ZIP export. Every document needs explicit approval. |
| **F8 Calendar** | Google Calendar and Microsoft Graph. Events are upserted on rectification and removed on cancellation. |
| **F9 Notifications** | Resend email and an in-app inbox. |
| **F10 Billing** | Free, Pro and Business plans with native AbacatePay (v2) subscriptions and usage limits enforced per organization. |

## Architecture

Clean architecture. Dependencies point inwards.

```
src/
  domain/          Pure business rules: plans, rule matching, citation checks, fit score,
                   document gaps/validity, bid lifecycle, templates, deadlines. No I/O.
  application/
    ports/         Interfaces for repositories and gateways, plus the pg-boss job contracts
    use-cases/     Orchestration (onboarding, radar, rules, analysis, bids, vault, calendar,
                   billing). Depends only on ports.
    testing/       In-memory adapters used by the use-case tests
  infrastructure/  Adapters: Prisma/pgvector, PNCP, BrasilAPI, Gemini (AI SDK), RustFS (S3),
                   Resend, AbacatePay, WorkOS, Google/Microsoft calendars, pandoc, pg-boss,
                   plus the composition root (container.ts)
  worker/          pg-boss worker: queue handlers and cron schedules
  web/             Next.js server helpers (session, actions) and shared components
  app/             Next.js App Router (pages, server actions, route handlers)
```

There are two runtime services built from one codebase:

- **web**: Next.js standalone. Handles UI, server actions and webhooks, and enqueues jobs.
- **worker**: Node + pg-boss with pandoc/LaTeX. All long or external work runs here as small idempotent jobs.

Data lives in **Postgres 18 + pgvector** (768-dim Gemini embeddings, HNSW cosine indexes). Files are stored in **RustFS** (S3 API).

## Local development

You need [devenv](https://devenv.sh) and direnv, plus Docker.

```bash
direnv allow                       # node 24, pnpm, pandoc, TeX Live, Prisma schema engine
cp .env.example .env               # set APP_SECRET (openssl rand -hex 32) and any API keys
docker compose up -d               # postgres (pgvector) + rustfs
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm db:seed                       # fictitious demo company, documents and edital
pnpm dev                           # http://localhost:3000 (web)
pnpm worker:dev                    # jobs + schedules (separate terminal)
```

With `DEMO_MODE=true`, open <http://localhost:3000/demo> to sign in as the seeded fictitious company. WorkOS is not needed for this. AI features need `GEMINI_API_KEY`. Any integration without credentials fails with a clear "not configured" error.

### Tests

```bash
pnpm test               # unit tests: domain, use cases (in-memory adapters), adapters (mocked HTTP)
pnpm test:integration   # repositories + an end-to-end flow on Postgres (needs docker compose up)
pnpm typecheck && pnpm lint
```

### Environment

See [`.env.example`](.env.example). It covers:

- Postgres, RustFS/S3 and Gemini
- WorkOS: create an owner role and set `WORKOS_ROLE_OWNER`; the redirect URI is `/callback`
- Resend
- AbacatePay: `pnpm billing:products` creates the monthly products and prints their ids
- Google and Microsoft OAuth apps, with redirect `/api/calendar/{google|microsoft}/callback`

Webhook endpoints:

| Provider | Endpoint |
|---|---|
| AbacatePay | `/api/webhooks/abacatepay?webhookSecret=…` |
| WorkOS | `/api/webhooks/workos` |
| Resend | `/api/webhooks/resend` |

## Deploy (self-hosted)

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml run --rm migrate pnpm db:seed   # demo data
```

Point the existing reverse proxy at `127.0.0.1:3000` for the web app. Also point it at `127.0.0.1:9000` (RustFS) and set `S3_PUBLIC_ENDPOINT`, so presigned download links resolve. Memory limits are sized for a 4 vCPU / 8 GB server. Backups are out of MVP scope (see SPEC §13).

## Hack Brasil compliance

- **License:** MIT. Every commit was made after the event started.
- **Demo data:** only fictitious. The seeded company and the edital are invented, and personal names in edital text are masked. AbacatePay runs in dev/sandbox mode only.
- **AI-assisted output:** analyses and generated documents are guidance and must be reviewed by the user.
