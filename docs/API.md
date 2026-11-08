# Concorra REST API (`/api/v1`)

All endpoints use JSON and the same session cookie as the web app:

- **WorkOS AuthKit** in production.
- `concorra_session` in demo or mock mode. Get one with `POST /api/mock/login`, body `{ "email": "…" }`.

Endpoints marked *org* need an active organization.

## Errors

Every error has the body `{ "error": { "code", "message", … } }`.

| Status | When |
|---|---|
| 400 | Invalid JSON or body (`details` holds the zod issues) |
| 401 | No session |
| 402 | Plan limit reached (`metric`, `limit`) |
| 403 | No active organization, or role not allowed |
| 404 | Not found, or belongs to another organization |
| 409 | Domain conflict (invalid transition, CNPJ taken, …) |
| 422 | Validation failure |

## Endpoints

### Account and organization

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | User, active organization, role, organizations |
| GET | `/companies/{cnpj}` | BrasilAPI lookup |
| POST | `/organizations` | Body `{ cnpj, profile? }`. Creates the organization and makes it the active one (F1) |
| GET · PATCH · DELETE | `/organization` | *org* · Profile. DELETE removes all the organization's data (LGPD) |
| GET | `/organization/usage` | *org* · Plan, usage and limits |
| GET · POST | `/experiences` | *org* · POST takes JSON (manual entry) or multipart `file` (atestado, extracted by AI) |
| GET · DELETE | `/experiences/{id}` | *org* |

### Notices and analysis

| Method | Path | Notes |
|---|---|---|
| GET | `/notices?q&uf&modalidadeId&openOnly&page&pageSize` | *org* · Ranked by affinity with the profile |
| GET | `/notices/{id}` | *org* · Items, files, latest analysis and bid. The first open triggers file ingestion |
| GET · POST | `/notices/{id}/analysis` | *org* · POST body `{ force? }` → 202. Quota-limited, runs in the worker |
| POST | `/notices/{id}/decision` | *org* · Body `{ decision: "participate" \| "skip", reason? }`. Participating builds the bid pack |
| GET | `/matches` | *org* · Rule matches |
| GET · POST | `/rules` | *org* |
| GET · PUT · DELETE | `/rules/{id}` | *org* |

### Bids

| Method | Path | Notes |
|---|---|---|
| GET | `/bids` | *org* |
| GET | `/bids/{id}` | *org* · Bid, notice, checklist, proposal lines, price references, generated documents and calendar event count |
| PUT | `/bids/{id}/prices` | *org* · Body `{ prices: { [numeroItem]: cents \| null } }` |
| POST | `/bids/{id}/status` | *org* · Body `{ status: "ready" \| "submitted" \| "cancelled" }` |
| PATCH | `/generated-documents/{id}` | *org* · Body `{ markdown }`. The document goes back to draft and is re-rendered |
| POST | `/generated-documents/{id}/approve` | *org* |

### Documents, notifications and billing

| Method | Path | Notes |
|---|---|---|
| GET · POST | `/documents` | *org* · POST takes multipart `kind` and `file`, then validation runs in the worker |
| GET · DELETE | `/documents/{id}` | *org* |
| GET | `/notifications` | *org* · Includes the `unread` count |
| POST | `/notifications/read` | *org* · Body `{ ids: string[] \| "all" }` |
| GET | `/billing` | *org* · Usage plus the plan catalog |
| POST | `/billing/checkout` | *org*, owner · Body `{ planId }` → `{ url }` (AbacatePay) |
| POST | `/billing/cancel` | *org*, owner |

### Members and calendars

| Method | Path | Notes |
|---|---|---|
| GET | `/members` | *org* |
| POST | `/members/invite` | *org*, owner · Body `{ email, role }` |
| GET | `/calendars` | *org* · The user's connections (tokens are never returned) |
| DELETE | `/calendars/{id}` | *org* |

## Other routes

| Route | Notes |
|---|---|
| `GET /api/files/{id}` | 302 to a short-lived presigned URL (org-scoped) |
| `GET /api/bids/{id}/zip` | Bid pack ZIP |
| `GET /api/calendar/{google\|microsoft}/connect` | Starts OAuth |
| `GET /api/calendar/{google\|microsoft}/callback` | Completes OAuth |
| `POST /api/webhooks/abacatepay?webhookSecret=…` | Webhook |
| `POST /api/webhooks/workos` | Webhook |
| `POST /api/webhooks/resend` | Webhook |
| `/api/mock/*` | Only with `MOCK_EXTERNAL=true`; see the README |
