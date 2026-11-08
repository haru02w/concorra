import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "@/web/server/api";
import { requireMockMode } from "@/web/server/mock";
import { setLocalSession } from "@/web/server/session";

/**
 * MOCK_EXTERNAL only: passwordless login standing in for WorkOS AuthKit.
 * GET ?email=&name=&redirect= (browser) or POST { email, name? } (API clients).
 */
async function login(email: string, name: string | null) {
  const { deps } = requireMockMode();
  const parsed = z.email().safeParse(email.trim().toLowerCase());
  if (!parsed.success) throw new ApiError(400, "invalid_email", "A valid email is required");
  const user = await deps.users.upsert({ workosUserId: `mock|${parsed.data}`, email: parsed.data, name });
  const organizations = await deps.memberships.listByUser(user.id);
  const active = organizations[0]?.organization ?? null;
  await setLocalSession({ u: user.id, o: active?.id ?? null });
  return { user, organization: active };
}

function fail(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  throw error;
}

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const { organization } = await login(q.get("email") ?? "dev@concorra.local", q.get("name"));
    const target = q.get("redirect") ?? (organization ? "/radar" : "/onboarding");
    return NextResponse.redirect(new URL(target.startsWith("/") ? target : "/", req.url));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = z.object({ email: z.string(), name: z.string().nullable().default(null) }).parse(await req.json());
    return NextResponse.json(await login(body.email, body.name));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "invalid_request", message: "email is required" } }, { status: 400 });
    return fail(error);
  }
}
