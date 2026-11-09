import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { loadEnv, workosConfigured } from "@/infrastructure/config/env";

let workos: ReturnType<typeof authkitProxy> | null | undefined;

/** Keeps the WorkOS session fresh; without WorkOS (demo/mock setups) it is a no-op. */
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Built on the first request, so `next build` never needs runtime env.
  workos ??= workosConfigured(loadEnv()) ? authkitProxy() : null;
  return workos ? workos(request, event) : NextResponse.next();
}

export const config = {
  // Never run on Next internals (incl. the dev HMR websocket) or provider webhooks.
  matcher: ["/((?!_next/|favicon.ico|api/webhooks).*)"],
};
