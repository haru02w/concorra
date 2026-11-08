import { addDays } from "@/domain/shared/dates";
import { NotFoundError } from "@/domain/shared/errors";
import { DOCUMENT_KIND_LABELS, EXPIRY_WARNING_DAYS, validateDocument, type DocumentKind, type VaultDocument } from "@/domain/documents/document";
import type { Deps } from "../shared/ports";
import { loadOrg, readFileText, storeUpload, type Actor, type Upload } from "../shared/context";
import type { NotificationsService } from "../notifications/notifications.service";

const toDate = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

export class DocumentsService {
  constructor(
    private readonly deps: Deps,
    private readonly notifications: NotificationsService,
  ) {}

  /** F6.1: upload → stored privately → AI validation job. */
  async uploadDocument(actor: Actor, input: { kind: DocumentKind; upload: Upload }): Promise<VaultDocument> {
    const file = await storeUpload(this.deps, actor.organizationId, input.upload);
    const doc = await this.deps.documents.create({
      organizationId: actor.organizationId,
      kind: input.kind,
      fileId: file.id,
      issuer: null,
      cnpj: null,
      issuedAt: null,
      validUntil: null,
      status: "pending",
      checks: [],
    });
    await this.deps.jobs.enqueue("docs.validate-upload", { documentId: doc.id });
    return doc;
  }

  /** Job: AI extracts type/issuer/CNPJ/dates; code decides validity. */
  async validateUploadedDocument(input: { documentId: string }): Promise<VaultDocument> {
    const doc = await this.deps.documents.findByIdUnscoped(input.documentId);
    if (!doc) throw new NotFoundError("Document", input.documentId);
    const file = await this.deps.files.findById(doc.fileId);
    if (!file) throw new NotFoundError("File", doc.fileId);
    const org = await loadOrg(this.deps, doc.organizationId);
    const { pages } = await readFileText(this.deps, file);
    const extracted = await this.deps.ai.extractDocument({ text: pages.join("\n\n").slice(0, 100_000), fileName: file.name });
    const validUntil = toDate(extracted.validUntil);
    const { status, checks } = validateDocument({
      orgCnpj: org.cnpj,
      extractedCnpj: extracted.cnpj,
      validUntil,
      kind: doc.kind,
      extractedKind: extracted.kind,
      now: this.deps.clock.now(),
    });
    const updated = await this.deps.documents.update(doc.id, {
      issuer: extracted.issuer,
      cnpj: extracted.cnpj,
      issuedAt: toDate(extracted.issuedAt),
      validUntil,
      status,
      checks,
      extracted,
    });
    if (validUntil) {
      await this.deps.jobs.enqueue("calendar.sync", { refType: "document", refId: doc.id, organizationId: doc.organizationId, action: "upsert" });
    }
    const failed = checks.filter((c) => !c.ok);
    await this.notifications.notifyOrganization(doc.organizationId,
      {
        type: "document_validated",
        title: failed.length ? `Documento com pendências: ${DOCUMENT_KIND_LABELS[doc.kind]}` : `Documento validado: ${DOCUMENT_KIND_LABELS[doc.kind]}`,
        body: checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.message}`).join("\n"),
        link: "/documents",
      },
      ["inapp"],
    );
    return updated;
  }

  /** Job (daily): warns about documents expiring within EXPIRY_WARNING_DAYS. */
  async expiryWatch(): Promise<number> {
    const now = this.deps.clock.now();
    const expiring = await this.deps.documents.listExpiringUnnotified(addDays(now, EXPIRY_WARNING_DAYS));
    for (const doc of expiring) {
      await this.notifications.notifyOrganization(doc.organizationId, {
        type: "document_expiring",
        title: `Documento vencendo: ${DOCUMENT_KIND_LABELS[doc.kind]}`,
        body: `${doc.fileName} vence em ${doc.validUntil?.toISOString().slice(0, 10)}. Emita uma nova via e envie ao cofre.`,
        link: "/documents",
      });
      await this.deps.documents.update(doc.id, { expiryNotifiedAt: now, status: doc.validUntil && doc.validUntil < now ? "expired" : "expiring" });
    }
    return expiring.length;
  }

  async deleteDocument(actor: Actor, id: string): Promise<void> {
    const doc = await this.deps.documents.findById(actor.organizationId, id);
    if (!doc) throw new NotFoundError("Document", id);
    await this.deps.jobs.enqueue("calendar.sync", { refType: "document", refId: doc.id, organizationId: actor.organizationId, action: "delete" });
    await this.deps.documents.delete(actor.organizationId, id);
    const file = await this.deps.files.findById(doc.fileId);
    if (file) {
      await this.deps.storage.delete(file.storageKey).catch(() => undefined);
      await this.deps.files.delete(file.id);
    }
  }

  /** Org-scoped short-lived download URL. */
  async fileDownloadUrl(actor: Actor, fileId: string): Promise<string> {
    const file = await this.deps.files.findById(fileId);
    if (!file || file.organizationId !== actor.organizationId) throw new NotFoundError("File", fileId);
    return this.deps.storage.presignGet(file.storageKey, 300, file.name);
  }

  async listDocuments(actor: Actor): Promise<VaultDocument[]> {
    return this.deps.documents.listByOrg(actor.organizationId);
  }

  async findDocument(actor: Actor, id: string): Promise<VaultDocument | null> {
    return this.deps.documents.findById(actor.organizationId, id);
  }
}
