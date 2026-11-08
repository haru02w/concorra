import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Actor } from "@/modules/shared/context";
import { DomainError, ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "@/domain/shared/errors";
import { getSession, type Session } from "./session";

/** HTTP error raised inside API handlers. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function errorResponse(error: unknown): Response {
  const body = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ error: { code, message, ...extra } }, { status });
  if (error instanceof ApiError) return body(error.status, error.code, error.message, error.details ? { details: error.details } : {});
  if (error instanceof z.ZodError) return body(400, "invalid_request", "Invalid request body", { details: z.flattenError(error) });
  if (error instanceof LimitExceededError) return body(402, error.code, error.message, { metric: error.metric, limit: error.limit });
  if (error instanceof NotFoundError) return body(404, error.code, error.message);
  if (error instanceof ForbiddenError) return body(403, error.code, error.message);
  if (error instanceof ValidationError) return body(422, error.code, error.message);
  if (error instanceof DomainError) return body(409, error.code, error.message);
  console.error("[api]", error);
  return body(500, "internal_error", "Unexpected error");
}

type Params = Record<string, string>;
interface Context<P extends Params> {
  req: NextRequest;
  params: P;
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === undefined) return new Response(null, { status: 204 });
  return NextResponse.json(result);
}

/** Route handler for signed-in users (organization optional, e.g. onboarding). */
export function withSession<P extends Params = Params>(handler: (ctx: Context<P> & { session: Session }) => Promise<unknown>) {
  return async (req: NextRequest, route: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = await getSession();
      if (!session) throw new ApiError(401, "unauthorized", "Sign in first");
      return toResponse(await handler({ req, params: await route.params, session }));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Route handler for members acting inside their active organization. */
export function withActor<P extends Params = Params>(handler: (ctx: Context<P> & { session: Session; actor: Actor }) => Promise<unknown>) {
  return withSession<P>(async (ctx) => {
    if (!ctx.session.actor) throw new ApiError(403, "organization_required", "Create or select an organization first");
    return handler({ ...ctx, actor: ctx.session.actor });
  });
}

export async function parseJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const raw = await req.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Body must be valid JSON");
  });
  return schema.parse(raw);
}

export async function parseUpload(req: NextRequest, field = "file") {
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "invalid_form", "Expected multipart/form-data");
  });
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "file_required", `Field "${field}" must be a file`);
  return { form, upload: { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } };
}

export const created = (body: unknown) => NextResponse.json(body, { status: 201 });
export const accepted = (body: unknown) => NextResponse.json(body, { status: 202 });

export function notFound(entity: string, id: string): never {
  throw new NotFoundError(entity, id);
}
