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

### Mock mode (no API keys)

`MOCK_EXTERNAL=true` keeps every adapter real but swaps the network for deterministic fakes (`src/infrastructure/mock`):

- **PNCP:** 24 fictitious notices with items, edital PDFs (some "scanned", which exercises OCR) and contracts.
- **Gemini:** the mock reads the real prompt and returns schema-valid answers whose citations are verbatim excerpts, so citation checks, gap lists and scores run for real. Embeddings are hashed into 768 dims.
- **BrasilAPI, AbacatePay, Google and Microsoft calendars:** answer in each service's own wire format.
- **WorkOS and Resend:** calls are recorded in an outbox instead of being sent.

The mock-only endpoints are:

| Endpoint | Purpose |
|---|---|
| `/api/mock/login?email=…` | Passwordless sign-in, replacing AuthKit |
| `POST /api/mock/jobs` `{ "name": "pncp.sync-open" }` | Run a job now instead of waiting for cron |
| `/api/mock/outbox?kind=mail\|workos\|payments\|calendar` | List what the mocked services "sent" |
| `/api/mock/abacatepay/checkout` | Fake hosted checkout; "paying" sends a signed webhook |

Mock mode refuses to start in production.

### REST API

JSON endpoints under `/api/v1` cover every use case and use the same session cookie as the web app. See [`docs/API.md`](docs/API.md).

### Tests

```bash
pnpm test               # unit: domain, use cases (in-memory adapters), adapters + mock network
pnpm test:integration   # repositories + a use-case flow on Postgres (needs docker compose up)
pnpm test:e2e           # headless: boots web + worker (MOCK_EXTERNAL) on a <db>_e2e database and drives the REST API
pnpm typecheck && pnpm lint
```

`pnpm test:e2e` runs the full journey over HTTP: onboarding, rules, PNCP sync, matches and email, AI analysis with verified citations, the upgrade through the checkout webhook, vault validation, calendar OAuth, the bid pack, pricing and approval, downloads and ZIP export, and org isolation. Server logs go to `.next-e2e/logs/`. Set `E2E_BASE_URL` to point it at a server that is already running.

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
