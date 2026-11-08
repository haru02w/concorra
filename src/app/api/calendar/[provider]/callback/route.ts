import { NextResponse, type NextRequest } from "next/server";
import { completeCalendarConnect } from "@/application/use-cases/calendar";
import { getDeps } from "@/web/server/container";
import { getSession } from "@/web/server/session";

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const session = await getSession();
  if (!session?.actor) return NextResponse.redirect(new URL("/sign-in", request.url));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/settings?calendar=error", request.url));
  try {
    await completeCalendarConnect(getDeps(), session.actor, { provider, code, state });
    return NextResponse.redirect(new URL("/settings?calendar=connected", request.url));
  } catch (error) {
    console.error("[calendar] callback", error);
    return NextResponse.redirect(new URL("/settings?calendar=error", request.url));
  }
}
