import type { PlanId } from "@/domain/billing/plans";
import { makeNotice, makeOrg } from "@/domain/fixtures";
import type { Notice } from "@/domain/notice/notice";
import type { Actor } from "../use-cases/context";
import { makeTestDeps, type TestDeps } from "./in-memory";

/** Creates deps with one organization, its owner and (optionally) a notice. */
export async function setup(options: { plan?: PlanId; notice?: Partial<Notice> | false } = {}) {
  const deps = makeTestDeps();
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
  return { deps, org, user, actor, notice: notice! };
}

export function memberOf(actor: Actor): Actor {
  return { ...actor, role: "member" };
}

export type { TestDeps };
