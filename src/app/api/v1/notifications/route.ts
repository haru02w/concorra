import { listNotifications } from "@/application/use-cases/notifications";
import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const GET = withActor(async ({ actor }) => {
  const deps = getDeps();
  const [notifications, unread] = await Promise.all([listNotifications(deps, actor), deps.notifications.countUnread(actor.organizationId, actor.userId)]);
  return { notifications, unread };
});
