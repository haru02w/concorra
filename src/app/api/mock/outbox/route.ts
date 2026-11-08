import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "@/web/server/api";
import { requireMockMode } from "@/web/server/mock";

const kind = z.enum(["mail", "workos", "payments", "calendar"]);

/** MOCK_EXTERNAL only: what the mocked services "sent" (emails, WorkOS calls, payments, calendar writes). */
export async function GET(req: NextRequest) {
  try {
    const { outbox } = requireMockMode();
    const parsed = kind.safeParse(req.nextUrl.searchParams.get("kind") ?? "mail");
    if (!parsed.success) throw new ApiError(400, "invalid_kind", "kind must be mail, workos, payments or calendar");
    return NextResponse.json({ kind: parsed.data, items: await outbox.list(parsed.data) });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    throw error;
  }
}

export async function DELETE() {
  try {
    await requireMockMode().outbox.clear();
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    throw error;
  }
}
