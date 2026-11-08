import { NextResponse } from "next/server";
import { exportBidZip } from "@/application/use-cases/bids";
import { NotFoundError } from "@/domain/shared/errors";
import { getDeps } from "@/web/server/container";
import { getSession } from "@/web/server/session";

/** ZIP bundle of the bid pack (generated DOCX/PDF, vault documents, checklist, instructions). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const { name, bytes } = await exportBidZip(getDeps(), session.actor, id);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
