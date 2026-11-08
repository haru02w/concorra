import { disconnectCalendar } from "@/application/use-cases/calendar";
import { withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

export const DELETE = withActor<{ id: string }>(async ({ actor, params }) => {
  await disconnectCalendar(getDeps(), actor, params.id);
});
