import type { PlanId } from "@/domain/billing/plans";
import { EDITAL_PAGES, makeDoc, makeItem, makeNotice, makeOrg } from "@/domain/fixtures";
import type { Notice } from "@/domain/notice/notice";
import { EMPTY_FILTERS } from "@/domain/rules/rule";
import type { RuleInput } from "../../rules/rules.service";
import { createServices } from "../../services";
import type { Actor } from "../context";
import { makeTestDeps, type TestDeps } from "./in-memory";

/** Creates deps + services with one organization, its owner and (optionally) a notice. */
export async function setup(options: { plan?: PlanId; notice?: Partial<Notice> | false } = {}) {
  const deps = makeTestDeps();
  const services = createServices(deps);
  const { id: _id, ...orgData } = makeOrg({ planId: options.plan ?? "pro" });
  const org = await deps.organizations.create(orgData);
  const user = await deps.users.upsert({ workosUserId: "user_wos_1", email: "owner@limpabem.test", name: "Owner" });
  await deps.memberships.upsert(org.id, user.id, "owner");
  const actor: Actor = { userId: user.id, workosUserId: user.workosUserId, email: user.email, organizationId: org.id, role: "owner" };
  let notice: Notice | null = null;
  if (options.notice !== false) {
    const { id: _n, filesIngestedAt: _f, ...data } = makeNotice(options.notice || {});
    notice = (await deps.notices.upsert({ ...data, raw: {} })).notice;
  }
  return { deps, services, org, user, actor, notice: notice! };
}

export function memberOf(actor: Actor): Actor {
  return { ...actor, role: "member" };
}

/** Gives the notice edital pages the fixture extraction can cite. */
export async function withEdital(deps: TestDeps, noticeId: string) {
  const [file] = await deps.noticeFiles.upsertMany(noticeId, [{ sequencialDocumento: 1, titulo: "Edital", tipo: null, url: "u" }]);
  deps.noticeFiles.rows.set("file-edital", { ...file, id: "file-edital" });
  deps.noticeFiles.rows.delete(file.id);
  await deps.noticeFiles.savePages("file-edital", EDITAL_PAGES.get("file-edital")!);
  await deps.notices.markFilesIngested(noticeId, new Date("2026-11-08T00:00:00Z"));
}

/** Setup plus a finished analysis of the notice (edital pages, items, a vault document). */
export async function analyzed(plan: "free" | "pro" = "pro") {
  const ctx = await setup({ plan });
  const { deps, services, notice, actor } = ctx;
  await withEdital(deps, notice.id);
  await deps.noticeFiles.saveChunks("file-edital", [{ page: 4, text: "Declaração de que não emprega menor", embedding: [] }]);
  await deps.notices.replaceItems(notice.id, [makeItem(), makeItem({ numeroItem: 2, descricao: "Sabão em barra", quantidade: 50 })], null);
  await deps.documents.create({ ...makeDoc(), organizationId: actor.organizationId });
  const analysis = await services.analysis.requestAnalysis(actor.organizationId, notice.id);
  await services.analysis.runAnalysis({ analysisId: analysis.id });
  deps.jobs.clear();
  return ctx;
}

export const ruleInput = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  name: "Limpeza",
  filters: { ...EMPTY_FILTERS, keywordsInclude: ["material de limpeza"] },
  semanticThreshold: null,
  minScore: null,
  channels: ["email", "inapp"],
  frequency: "immediate",
  active: true,
  ...overrides,
});

export type { TestDeps };
