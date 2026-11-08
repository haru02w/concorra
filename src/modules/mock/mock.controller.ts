/** MOCK_EXTERNAL-only endpoints (404 otherwise): login, jobs, outbox and the fake AbacatePay checkout. */
import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { JOB_NAMES, type JobName, type JobPayloads } from "@/modules/shared/ports";
import { paymentWebhookSecret } from "@/infrastructure/container";
import { ABACATEPAY_PUBLIC_HMAC_KEY } from "@/infrastructure/payments/abacatepay";
import { accepted, ApiError, parseJson, withSession } from "@/web/server/api";
import { requireMockMode } from "@/web/server/mock";
import { setLocalSession } from "@/web/server/session";

const outboxKind = z.enum(["mail", "workos", "payments", "calendar"]);

function fail(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  throw error;
}

/** Passwordless login standing in for WorkOS AuthKit. */
async function login(email: string, name: string | null) {
  const { services } = requireMockMode();
  const parsed = z.email().safeParse(email.trim().toLowerCase());
  if (!parsed.success) throw new ApiError(400, "invalid_email", "A valid email is required");
  const { user, organization } = await services.auth.signInLocal(parsed.data, name);
  await setLocalSession({ u: user.id, o: organization?.id ?? null });
  return { user, organization };
}

/** GET /api/mock/login?email=&name=&redirect= (browser). */
export async function loginRedirect(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const { organization } = await login(q.get("email") ?? "dev@concorra.local", q.get("name"));
    const target = q.get("redirect") ?? (organization ? "/radar" : "/onboarding");
    return NextResponse.redirect(new URL(target.startsWith("/") ? target : "/", req.url));
  } catch (error) {
    return fail(error);
  }
}

/** POST /api/mock/login { email, name? } (API clients). */
export async function loginJson(req: NextRequest) {
  try {
    const body = z.object({ email: z.string(), name: z.string().nullable().default(null) }).parse(await req.json());
    return NextResponse.json(await login(body.email, body.name));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "invalid_request", message: "email is required" } }, { status: 400 });
    return fail(error);
  }
}

/** POST /api/mock/jobs: enqueue any worker job now (e.g. { "name": "pncp.sync-open" }) instead of waiting for cron. */
export const runJob = withSession(async ({ req }) => {
  const { jobs } = requireMockMode();
  const { name, data } = await parseJson(req, z.object({ name: z.enum(JOB_NAMES), data: z.record(z.string(), z.unknown()).default({}) }));
  await jobs.enqueue(name as JobName, data as JobPayloads[JobName]);
  return accepted({ enqueued: name });
});

/** GET /api/mock/outbox?kind=: what the mocked services "sent" (emails, WorkOS calls, payments, calendar writes). */
export async function listOutbox(req: NextRequest) {
  try {
    const { outbox } = requireMockMode();
    const parsed = outboxKind.safeParse(req.nextUrl.searchParams.get("kind") ?? "mail");
    if (!parsed.success) throw new ApiError(400, "invalid_kind", "kind must be mail, workos, payments or calendar");
    return NextResponse.json({ kind: parsed.data, items: await outbox.list(parsed.data) });
  } catch (error) {
    return fail(error);
  }
}

export async function clearOutbox() {
  try {
    await requireMockMode().outbox.clear();
    return new Response(null, { status: 204 });
  } catch (error) {
    return fail(error);
  }
}

/**
 * GET /api/mock/abacatepay/checkout: stands in for AbacatePay's hosted checkout. "Paying" sends a
 * signed `subscription.completed` webhook to our own endpoint, then returns to the app.
 */
export async function checkout(req: NextRequest) {
  try {
    const { env } = requireMockMode();
    const q = req.nextUrl.searchParams;
    const checkoutId = q.get("id");
    if (!checkoutId) throw new ApiError(400, "invalid_request", "id is required");
    const rawBody = JSON.stringify({
      id: `log_mock_${crypto.randomUUID()}`,
      event: "subscription.completed",
      apiVersion: 2,
      devMode: true,
      data: {
        subscription: { id: `subs_mock_${checkoutId.slice(-12)}`, status: "ACTIVE" },
        checkout: { id: checkoutId, externalId: q.get("externalId"), status: "PAID" },
        customer: { id: q.get("customerId") },
      },
    });
    const signature = createHmac("sha256", ABACATEPAY_PUBLIC_HMAC_KEY).update(rawBody).digest("base64");
    const webhook = await fetch(`${env.APP_URL}/api/webhooks/abacatepay?webhookSecret=${encodeURIComponent(paymentWebhookSecret(env))}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-signature": signature },
      body: rawBody,
    });
    if (!webhook.ok) throw new ApiError(502, "webhook_failed", `Webhook returned ${webhook.status}`);
    const completion = q.get("completionUrl");
    return NextResponse.redirect(completion && completion.startsWith(env.APP_URL) ? completion : `${env.APP_URL}/billing?checkout=done`);
  } catch (error) {
    return fail(error);
  }
}
