import { NextResponse } from "next/server";
import { fileDownloadUrl } from "@/application/use-cases/documents";
import { NotFoundError } from "@/domain/shared/errors";
import { getDeps } from "@/web/server/container";
import { getSession } from "@/web/server/session";

/** Org-scoped download: redirects to a short-lived presigned URL. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.redirect(await fileDownloadUrl(getDeps(), session.actor, id), 302);
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
