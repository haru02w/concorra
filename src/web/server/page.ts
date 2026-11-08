import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/domain/shared/errors";

/** Renders the 404 page when a service reports a missing (or other organization's) entity. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
