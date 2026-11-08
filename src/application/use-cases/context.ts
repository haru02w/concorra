import { usagePeriod } from "@/domain/shared/dates";
import { ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "@/domain/shared/errors";
import { limitFor, type LimitedMetric, MONTHLY_METRICS } from "@/domain/billing/plans";
import { canManage, type Organization, type Role } from "@/domain/organization/organization";
import { UPLOAD_MAX_BYTES, UPLOAD_MIME_ALLOWLIST } from "@/domain/documents/document";
import type { Deps, StoredFile } from "../ports";

/** The authenticated member acting inside an organization. */
export interface Actor {
  userId: string;
  workosUserId: string;
  email: string;
  organizationId: string;
  role: Role;
}

export function requireOwner(actor: Actor): void {
  if (!canManage(actor.role)) throw new ForbiddenError("Only owners can do this");
}

export async function loadOrg(deps: Pick<Deps, "organizations">, organizationId: string): Promise<Organization> {
  const org = await deps.organizations.findById(organizationId);
  if (!org) throw new NotFoundError("Organization", organizationId);
  return org;
}

/** Consumes one unit of a monthly metric or throws LimitExceededError. */
export async function consumeQuota(
  deps: Pick<Deps, "organizations" | "usage" | "clock">,
  organizationId: string,
  metric: (typeof MONTHLY_METRICS)[number],
): Promise<void> {
  const org = await loadOrg(deps, organizationId);
  const limit = limitFor(org.planId, metric);
  const ok = await deps.usage.tryConsume(organizationId, metric, usagePeriod(deps.clock.now()), limit);
  if (!ok) throw new LimitExceededError(metric, limit ?? 0);
}

export async function releaseQuota(
  deps: Pick<Deps, "usage" | "clock">,
  organizationId: string,
  metric: LimitedMetric,
): Promise<void> {
  await deps.usage.release(organizationId, metric, usagePeriod(deps.clock.now()));
}

export interface Upload {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Buffer.from(digest).toString("hex");
}

export function safeFileName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120) || "file";
}

/** Validates (size + MIME allowlist) and stores a user upload privately. */
export async function storeUpload(
  deps: Pick<Deps, "storage" | "files">,
  organizationId: string,
  upload: Upload,
): Promise<StoredFile> {
  if (upload.bytes.byteLength === 0) throw new ValidationError("Arquivo vazio");
  if (upload.bytes.byteLength > UPLOAD_MAX_BYTES) throw new ValidationError("Arquivo maior que 15 MB");
  if (!UPLOAD_MIME_ALLOWLIST.includes(upload.mime)) throw new ValidationError("Formato não suportado (PDF, PNG ou JPEG)");
  return storeBytes(deps, organizationId, upload);
}

export async function storeBytes(
  deps: Pick<Deps, "storage" | "files">,
  organizationId: string | null,
  upload: Upload,
  prefix = organizationId ? `orgs/${organizationId}` : "shared",
): Promise<StoredFile> {
  const key = `${prefix}/${crypto.randomUUID()}/${safeFileName(upload.name)}`;
  await deps.storage.put(key, upload.bytes, upload.mime);
  return deps.files.create({
    organizationId,
    storageKey: key,
    name: upload.name,
    mime: upload.mime,
    size: upload.bytes.byteLength,
    sha256: await sha256(upload.bytes),
  });
}

/** Text per page of a stored file, falling back to AI OCR when there is no text layer. */
export async function readFileText(
  deps: Pick<Deps, "storage" | "pdfText" | "ai">,
  file: Pick<StoredFile, "storageKey" | "mime">,
): Promise<{ pages: string[]; ocr: boolean }> {
  const bytes = await deps.storage.get(file.storageKey);
  if (file.mime === "application/pdf") {
    const pages = await deps.pdfText.extractPages(bytes);
    const textChars = pages.join("").replace(/\s/g, "").length;
    // Scanned PDFs have (almost) no text layer: < 10 chars per page on average.
    if (pages.length && textChars >= 10 * pages.length) return { pages, ocr: false };
  }
  return { pages: await deps.ai.ocr({ bytes, mediaType: file.mime }), ocr: true };
}
