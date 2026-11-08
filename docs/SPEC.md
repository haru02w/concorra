# Concorra — System Specification

> Status: draft · Last updated: 2026-11-08 · Track: **Logística & Automação** (Hack Brasil 2026)

## 1. Overview

Concorra watches Brazilian public procurement publications (PNCP), tells a company which *editais* are worth its time, and — once the company decides to bid — prepares everything needed to participate: qualification documents gathered and verified, declarations and proposal drafted, deadlines pushed to the team's calendar, and step-by-step instructions for submitting on the bidding portal.

**Competitor:** [Effecti](https://www.effecti.com.br/) (monitoring + bid management).

**Differential:** automate the boring part — getting the *right* documents, valid on the *right* date, written and verified by AI — instead of only monitoring.

**Human in the loop:** Concorra never submits anything on the user's behalf. It produces a ready-to-send bid pack plus instructions; the user submits.

## 2. Goals & non-goals

### Goals
- G1. Ingest procurement notices from PNCP continuously.
- G2. Let companies define notification rules and get alerted on matching notices.
- G3. AI analysis of each notice against the company's profile, field of expertise and past experience (atestados), with an explainable fit score.
- G4. On "participate", generate a bid pack: required documents checklist, validated documents, AI-written declarations and proposal, price references, submission instructions.
- G5. Push deadlines (proposal opening/closing, document expirations, clarification deadlines) to Google Calendar and Outlook.
- G6. Tiered paid plans via AbacatePay.

### Non-goals
- Submitting proposals, documents or bids to any portal.
- Issuing documents that require the company's ICP-Brasil digital certificate.
- Legal or accounting advice; results are guidance only.
- Mobile apps.
- Task-management integrations (Trello, Asana, etc.).

## 3. Phases

| Phase | Scope |
|---|---|
| **MVP** (Hack Brasil submission, 2026-11-30) | F1–F10 as specified below, with certidões **upload-only** (F6) |
| **Later** | Automatic certidão fetching by CNPJ (F6.2); backups (Postgres + object storage) |

## 4. Hackathon compliance (Hack Brasil 2026 regulamento)

| Rule | Requirement | How we comply |
|---|---|---|
| 6.1 | Public GitHub repo created after 2026-11-04 21:00 BRT; all commits after that | This repo; no imported history |
| 6.2 | No private pre-event code; public OSS allowed if source is cited in the commit | Dependencies via npm; any copied boilerplate gets a commit citing its source |
| 6.4–6.5 | AI tools allowed; respect third-party licenses | Allowed; review licenses of deps |
| 6.6 | License must not prevent judges from reading/running/testing | **MIT** |
| 6.7 | Repo public until at least 2026-12-15 | Do not privatize/delete |
| 6.9 | Demos must not expose real third-party personal data; finance demos in sandbox | Fictitious demo company; mask personal names found in edital PDFs; AbacatePay sandbox only |
| 7.1 | Submission by **2026-11-30 23:59 BRT**; repo evaluated at last commit before that | Freeze target before the deadline |
| 7.2 | Name, tagline, description, track, repo link, **working demo link**, **≤3 min video** (no login to view) | See §14 |
| 7.3 | Demo must stay online during evaluation | Self-hosted deploy + seeded demo account |
| 8.4 | Finalists: code freeze from 2026-11-30 until the final (2026-12-12) | No commits in that window |
| 9.1 | Criteria: technical execution, technical implementation, impact, communication (equal weight) | — |

## 5. Users & tenancy

- **Organization** = one company (one CNPJ). Backed by a WorkOS Organization.
- **Members** belong to an organization. Roles:
  - `owner` — billing, members, integrations, everything else.
  - `member` — rules, analyses, bid packs, documents.
- A user may belong to more than one organization (org switcher).
- Every domain row is scoped by `organizationId`; all queries enforce it.

## 6. Features

### F1. Onboarding & company profile
- Sign up / sign in via WorkOS AuthKit; create organization.
- Enter CNPJ → prefill company data (razão social, CNAEs, porte, address) from **BrasilAPI** (`GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}`); result cached; user can edit.
- Profile fields:
  - CNAEs (primary/secondary) and free-text field of expertise.
  - Regions of interest (UF / municípios).
  - Value range of interest (min/max estimated value).
  - Porte (ME/EPP/other) — affects benefits under LC 123/2006.
  - **Experience:** uploaded atestados de capacidade técnica and past contracts; AI extracts object, quantities, issuer, period. Embedded for matching (pgvector).

### F2. Radar (PNCP ingestion)
- Coverage: **all of Brazil, all modalidades** — metadata only.
- Scheduled job pulls open notices and recently updated notices (§9).
- For each notice store metadata and items; embed object + items.
- **Lazy files:** edital + annexes are downloaded, text-extracted per page, chunked and embedded **only** when a rule matches the notice or a user opens it.
- Scanned PDFs (no text layer) → OCR via Gemini multimodal.
- Notices are deduplicated by `numeroControlePNCP` and updated on `dataAtualizacaoGlobal` changes (retificações).

### F3. Notification rules
- A rule is a saved filter, per organization:
  - Keywords (include/exclude) over object and items.
  - Semantic match against the company profile/experience (embedding similarity threshold).
  - UF / município, modalidade, value range, órgão.
  - Minimum fit score (after AI analysis).
- Channels: email (Resend) and in-app inbox.
- Frequency: immediate or daily digest.

### F4. AI analysis of a notice
Triggered automatically for rule matches (plan-limited) or on demand.

Output:
- **Structured extraction** of the edital: object, items/lots, key dates (impugnação, esclarecimentos, abertura, sessão), habilitação requirements (jurídica, fiscal/trabalhista, econômico-financeira, técnica), exclusivity for ME/EPP, guarantees, visita técnica, sample requirements, penalties.
- **Citations:** every extracted field carries file, page and verbatim excerpt. A deterministic validator checks the excerpt exists in the source text; fields that fail are re-extracted once, then marked *unverified*.
- **Fit score (0–100)**, explainable: weighted factors shown to the user (object similarity to experience, CNAE match, region, value range, document readiness, deadline feasibility).
- **Risks:** unusual or restrictive clauses, tight deadlines, missing qualifications.
- **Document gap list:** each required document → `have / expiring before deadline / missing`.
- Recommendation: participate / review / skip, with reasons.

### F5. Participation decision
- User marks a notice as **Participating** (or Skipped, with optional reason to improve future matching).
- Participating creates a **Bid** and triggers F6 and F7.

### F6. Document vault & verification

**F6.1 Upload & AI validation (MVP)**
- User uploads certidões and other documents (balanço, contrato social, atestados, licenses).
- For each certidão type the UI shows a **deep link to the issuing portal** (e.g., CND Federal — Receita/PGFN, CRF FGTS — Caixa, CNDT — TST, state and municipal certidões).
- AI extracts type, issuer, CNPJ, issue date and validity; deterministic checks confirm the CNPJ matches the org and validity covers the bid's deadline.
- Expiration tracking: alert N days before a document expires (email + calendar event).
- All documents stored privately, versioned, deletable by the user.

**F6.2 Automatic certidão fetching (Later)**
- Fetch certidões by CNPJ on schedule and on `bid.created`. Approach (aggregator API vs. own fetching) to be decided when the phase starts; several portals use captchas.

### F7. Bid pack generation
For a Bid, generate:
- **Checklist** of every habilitação requirement mapped to a vault document (with status).
- **AI-written documents** from templates + edital + company data:
  - Standard declarations (e.g., não emprega menor, ME/EPP, fatos impeditivos, cumprimento dos requisitos de habilitação — exact set taken from the edital).
  - Proposta comercial draft (items, quantities, unit/total prices entered or confirmed by the user).
  - Cover letter / other annex models required by the edital.
- **Price references (simple):** for each item, similar past PNCP contracts/items with their prices (pgvector similarity), labeled as reference only — never auto-filled into the proposta.
- **Verification pass:** AI + deterministic checks that each generated document references the correct edital number, órgão, CNPJ, dates and items.
- **Submission instructions:** step-by-step guide for the specific portal (from `linkSistemaOrigem` / `linkProcessoEletronico`), including what to upload where and in which order.
- **Formats:** templates are **Markdown** with placeholders → rendered by pandoc to **DOCX** and to **PDF** (LaTeX engine) from the same source, rendered in the `worker` (pandoc + LaTeX).
- Export: individual files (DOCX + PDF) and a ZIP bundle.
- Every generated document requires explicit user review/approval before it's marked ready.

### F8. Calendar sync
- OAuth connections per user: **Google Calendar** and **Microsoft 365 / Outlook** (Microsoft Graph).
- Events created for a Bid: clarification/impugnação deadline, proposal deadline, session date; and for vault documents: expiration reminders.
- Events are updated when the notice is rectified; deleted when the Bid is cancelled.

### F9. Notifications
- Resend for transactional email: rule matches, digests, analysis ready, document expiring, deadline reminders, billing.
- In-app notification inbox.

### F10. Billing

| | Free | Pro | Business |
|---|---|---|---|
| Price (BRL/month) | R$ 0 | R$ 99 | R$ 299 |
| Members | 1 | 3 | 10 |
| Active rules | 2 | 20 | Unlimited |
| AI analyses / month | 5 | 50 | 200 |
| Bid packs / month | 0 | 10 | 50 |

- Payments via AbacatePay (Pix/card); sandbox only for the hackathon demo.
- **Recurring:** AbacatePay v2 native subscriptions (`/subscriptions/create`, monthly products); `subscription.*` webhooks activate, renew, flag failed payments and cancel.
- Limits enforced per organization via usage counters.
- Webhooks signature-validated and processed idempotently.

## 7. Architecture

Self-hosted on a single server (4 vCPU, 8 GB RAM, 2 TB disk) with Docker Compose. TLS and routing are handled by the server's **existing reverse proxy** (not part of this repo); the compose file only exposes the services it needs.

```
                 existing reverse proxy (TLS)
                            │
 ┌──────────────────────────┼──────────── Docker Compose ───────────────┐
 │                  ┌───────▼────────┐          ┌──────────────────┐     │
 │                  │ web            │          │ worker           │     │
 │                  │ Next.js        │          │ Node + pg-boss   │     │
 │                  │ (standalone)   │          │ pandoc + LaTeX   │     │
 │                  │ UI, API,       │          │ jobs + cron      │     │
 │                  │ webhooks       │          └───┬──────────┬───┘     │
 │                  └──┬──────────┬──┘              │          │         │
 │                     │ Prisma   │ S3 API          │          │         │
 │               ┌─────▼──────────┴─────────────────▼┐  ┌──────▼──────┐  │
 │               │ postgres (pgvector) — data + queue│  │ rustfs      │  │
 │               └───────────────────────────────────┘  │ (files)     │  │
 │                                                      └─────────────┘  │
 └───────────────────────────────────────────────────────────────────────┘
 External: PNCP API · BrasilAPI · Gemini · WorkOS · Resend · AbacatePay
           Google Calendar API · Microsoft Graph
```

### Services (docker-compose)
| Service | Image / build | Role |
|---|---|---|
| `web` | Next.js `output: "standalone"` | UI, route handlers, server actions, webhooks; enqueues jobs |
| `worker` | Same codebase, Node entrypoint + pandoc + TeX (LaTeX) | Runs pg-boss jobs and schedules; document rendering |
| `postgres` | `pgvector/pgvector` | App data, embeddings, pg-boss queue tables |
| `rustfs` | `rustfs/rustfs` | Private S3-compatible object storage (MinIO CE is archived/unmaintained) |

### Stack
| Concern | Choice |
|---|---|
| App | Next.js (App Router), TypeScript, single codebase (web + worker) |
| DB | PostgreSQL + pgvector (self-hosted) |
| ORM | Prisma (pgvector columns via `Unsupported("vector(N)")` + raw SQL for similarity queries) |
| Jobs | pg-boss (queues, cron schedules, retries with backoff, singleton/throttle keys) in the `worker` service |
| Hosting | Self-hosted, Docker Compose, behind the existing reverse proxy |
| Auth | WorkOS AuthKit + Organizations |
| Email | Resend |
| Payments | AbacatePay |
| LLM | Gemini, behind a provider-agnostic layer (e.g., Vercel AI SDK); model per task configurable via env |
| Embeddings | Gemini embeddings, behind the same layer |
| OCR | Gemini multimodal |
| Files | RustFS (S3 API), private bucket, short-lived presigned URLs |
| Documents | Markdown templates → pandoc (DOCX) + pandoc/LaTeX (PDF), in `worker` |
| Company data | BrasilAPI CNPJ |

### Principles
- Single language (TypeScript), one repo, one compose file.
- All long or external work runs as pg-boss jobs in `worker`, never in a request.
- Multi-step jobs (e.g., bid pack) are split into small idempotent jobs that persist progress in Postgres, so retries resume instead of restarting.
- Edital/document text is **untrusted input** to the LLM (prompt-injection safe: no tool access from extraction prompts, structured output only).
- Deterministic code decides dates, validity and matching; the LLM extracts and drafts.

## 8. PNCP integration

Public, no auth required.

| Purpose | Endpoint |
|---|---|
| Open notices (proposal reception open) | `GET https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?dataFinal=yyyyMMdd&pagina=N&tamanhoPagina≤50` (optional: `codigoModalidadeContratacao`, `uf`, `codigoMunicipioIbge`, `cnpj`) |
| New publications | `GET /api/consulta/v1/contratacoes/publicacao?dataInicial&dataFinal&codigoModalidadeContratacao&pagina` |
| Updates / rectifications | `GET /api/consulta/v1/contratacoes/atualizacao?dataInicial&dataFinal&codigoModalidadeContratacao&pagina` |
| Notice detail | `GET /api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` |
| Items | `GET https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens?pagina&tamanhoPagina` |
| Files list | `GET https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos` |
| File download | `url` field from files list |
| Price references | `GET /api/consulta/v1/contratos?dataInicial&dataFinal&pagina` + items of the related compras |

Notes:
- Paginated envelope: `data`, `totalRegistros`, `totalPaginas`, `numeroPagina`, `paginasRestantes`.
- `/publicacao` and `/atualizacao` require `codigoModalidadeContratacao` → iterate modalidades.
- Ingestion runs as pg-boss jobs with a concurrency cap and backoff to be polite to PNCP.
- Idempotency key: `numeroControlePNCP`.

## 9. Background jobs (pg-boss)

Each row is a queue handled by `worker` (pg-boss names allow only letters, digits, `-`, `_`, `.`). Also `experience.extract` and `org.embed-profile`. *Schedule* = pg-boss cron; *events* = jobs enqueued by `web` or by other jobs.

| Queue | Trigger | Does |
|---|---|---|
| `pncp.sync-open` | schedule | Page through open notices, upsert metadata + items, embed, emit `notice.upserted` |
| `pncp.sync-updates` | schedule | Pull updated notices since last cursor, emit `notice.updated` |
| `pncp.sync-contracts` | schedule | Ingest contracts/items for price references, embed |
| `rules.match` | `notice.upserted`, `notice.updated` | Evaluate all rules; create matches; emit `match.created` |
| `notice.ingest-files` | `match.created`, user opens notice | Download files, extract text per page (OCR if scanned), chunk, embed |
| `notify.send` / `notify.digest` | `match.created`, schedule (digest) | Email + in-app |
| `analysis.run` | `notice.files-ingested` (plan-limited) / user | Extraction → citation validation → gap list → score |
| `bid.build-pack` / `bid.render-doc` | `bid.created` | Validate docs, price references, draft + render documents, verify, instructions |
| `docs.validate-upload` | `document.uploaded` | AI extraction + deterministic checks |
| `docs.expiry-watch` | schedule | Expiration alerts |
| `calendar.sync` | `bid.*`, `document.*` | Upsert/delete calendar events |
| `billing.webhook` | AbacatePay webhook | Update subscription, limits |

Progress for user-triggered jobs is shown in the UI (polling or streaming).

## 10. Data model (Prisma, outline)

`vector(768)` (Gemini `outputDimensionality: 768`, re-normalized; HNSW cosine indexes).

```
Organization(id, workosOrgId, cnpj, razaoSocial, porte, cnaes[], ufs[], municipios[], valueMin, valueMax, expertiseText, ...)
Membership(id, organizationId, userId, role[owner|member])
User(id, workosUserId, email, name)

Experience(id, organizationId, fileId, issuer, object, quantities, periodStart, periodEnd, extracted jsonb, embedding vector)

Notice(id, numeroControlePNCP UNIQUE, orgaoCnpj, ano, sequencial, objeto, modalidade, modoDisputa, situacao,
       valorEstimado, uf, municipioIbge, dataPublicacao, dataAbertura, dataEncerramento, linkSistemaOrigem,
       raw jsonb, updatedAtPncp, filesIngestedAt, embedding vector)
NoticeItem(id, noticeId, numeroItem, descricao, quantidade, unidade, valorUnitario, ..., embedding vector)
NoticeFile(id, noticeId, sequencialDocumento, tipo, titulo, url, storageKey, pageCount, ocr bool)
NoticePage(id, noticeFileId, page, text)   -- full page text for citation checks
NoticeChunk(id, noticeFileId, page, text, embedding vector)

ContractItem(id, numeroControlePNCP, orgaoCnpj, descricao, unidade, quantidade, valorUnitario, dataAssinatura, uf, embedding vector)

Rule(id, organizationId, name, filters jsonb, semanticThreshold, minScore, channels[], frequency, active)
Match(id, ruleId, noticeId, organizationId, similarity, notifiedAt)

Analysis(id, organizationId, noticeId, status, extraction jsonb, citations jsonb, score, scoreFactors jsonb,
         risks jsonb, gaps jsonb, recommendation, model, createdAt)

Bid(id, organizationId, noticeId, analysisId, status[participating|skipped|ready|submitted|cancelled], skipReason)
GeneratedDocument(id, bidId, kind, markdown, docxFileId, pdfFileId, status[draft|approved], verification jsonb)

Document(id, organizationId, kind, source[uploaded|fetched], fileId, issuer, issuedAt, validUntil, extracted jsonb, status)
File(id, organizationId, storageKey, mime, size, sha256)

CalendarConnection(id, userId, provider[google|microsoft], tokens encrypted, calendarId)
CalendarEvent(id, connectionId, refType, refId, externalId)

Notification(id, organizationId, userId?, type, payload jsonb, readAt)

Plans: code constants (src/domain/billing/plans.ts), not a table
Subscription(id, organizationId, planId, pendingPlanId, status, customerRef, checkoutRef, subscriptionRef, currentPeriodEnd)
UsageCounter(id, organizationId, metric, period, count)
WebhookEvent(id, provider, externalId UNIQUE, payload, processedAt)
```

## 11. AI design

- **Provider-agnostic layer;** Gemini as the initial provider. Each task (`extract`, `classify`, `draft`, `verify`, `embed`, `ocr`) maps to a configurable model.
- **Structured outputs** validated with zod; retry on schema failure.
- **Citations required** for every extracted fact; deterministic substring/fuzzy check against stored page text.
- **Matching:** pgvector similarity between notice (object + items + chunks) and organization (expertise + experiences), combined with deterministic filters.
- **Drafting:** Markdown templates with slots; LLM fills narrative parts only; structured fields (CNPJ, edital number, dates, items) are filled by code.
- **Verification:** a second pass compares generated docs against edital requirements and company data; mismatches block "ready".
- **Safety:** edital text treated as untrusted; no tool use in extraction; personal names in edital PDFs masked in demo.
- **Cost control:** plan limits, lazy file ingestion, caching analysis per notice version, chunk-level retrieval instead of whole-PDF prompts when possible.

## 12. Security & privacy (LGPD)

- WorkOS sessions; org-scoped authorization on every query and file access.
- Files in a private RustFS bucket; short-lived presigned URLs; RustFS not exposed publicly except through presigned URLs via the reverse proxy.
- OAuth tokens (calendar) encrypted at rest.
- Webhooks (AbacatePay, WorkOS, Resend) signature-verified and idempotent (`WebhookEvent`).
- Upload limits: size and MIME allowlist.
- Disclosure that documents are processed by third-party AI providers; user can delete documents and organization data.
- Secrets only in env vars; test/sandbox keys for the hackathon.

## 13. Risks

- **Single server:** no redundancy; 8 GB RAM shared by Postgres, RustFS, web and worker — cap worker concurrency (PDF parsing, LaTeX) accordingly.
- **No backups in MVP:** data loss on disk failure is accepted for the hackathon; add `pg_dump` + object storage backup in a later phase.
- **PNCP availability/rate limits:** no published SLA; mitigate with backoff, cursors and idempotent upserts.
- **BrasilAPI:** no SLA; profile remains manually editable.
- **AbacatePay recurring:** native v2 subscriptions confirmed (2026-11-08); refunds of subscriptions are not supported by the API.

## 14. Hackathon deliverables (due 2026-11-30 23:59 BRT)

- [ ] Public repo with README (setup, env vars, architecture, demo instructions) and MIT license
- [ ] Live demo on the self-hosted server with a seeded **fictitious** company and a no-friction demo login
- [ ] Video ≤ 3 min, public, showing: profile → radar match → AI analysis with citations → participate → bid pack (docs + price references + instructions) → calendar event → plan upgrade in sandbox
- [ ] Submission form: name, tagline, description, track (Logística & Automação), repo, demo, video, acceptance

## 15. Open questions

1. ~~Embedding dimension~~ — decided: 768 (`gemini-embedding-001`, `outputDimensionality: 768`).
2. ~~AbacatePay native subscriptions~~ — confirmed in API v2; implemented without the renewal job.
3. **F6.2 certidão fetching approach** (Later phase).
