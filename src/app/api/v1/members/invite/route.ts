import { z } from "zod";
import { inviteMember } from "@/application/use-cases/organizations";
import { accepted, parseJson, withActor } from "@/web/server/api";
import { getDeps } from "@/web/server/container";

/** Sends a WorkOS invitation. Body: { email, role }. */
export const POST = withActor(async ({ req, actor }) => {
  const input = await parseJson(req, z.object({ email: z.string(), role: z.enum(["owner", "member"]).default("member") }));
  await inviteMember(getDeps(), actor, input);
  return accepted({ invited: input.email });
});
