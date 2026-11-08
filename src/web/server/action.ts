import "server-only";
import { unstable_rethrow } from "next/navigation";
import { DomainError } from "@/domain/shared/errors";

export type ActionState = { ok: boolean; message?: string; error?: string } | null;

/**
 * Runs a server-action body and turns domain errors into a form-friendly state.
 * Redirects and other Next.js control-flow errors are rethrown.
 */
export async function runAction(fn: () => Promise<unknown>, success?: string): Promise<ActionState> {
  try {
    await fn();
    return { ok: true, message: success };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof DomainError) return { ok: false, error: error.message };
    console.error("[action]", error);
    return { ok: false, error: error instanceof Error && /not configured/.test(error.message) ? error.message : "Erro inesperado. Tente novamente." };
  }
}

export function formString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function formNumber(form: FormData, key: string): number | null {
  const v = formString(form, key).replace(/\./g, "").replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formList(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .flatMap((v) => (typeof v === "string" ? v.split(/[,;\n]/) : []))
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function formUpload(form: FormData, key: string): Promise<{ name: string; mime: string; bytes: Uint8Array } | null> {
  const file = form.get(key);
  if (!(file instanceof File) || file.size === 0) return null;
  return { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}
