import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { authkitProxy } from "@workos-inc/authkit-nextjs";

const mock = process.env.MOCK_EXTERNAL === "true" || process.env.MOCK_EXTERNAL === "1";
const workos = !mock && process.env.WORKOS_CLIENT_ID && process.env.WORKOS_API_KEY ? authkitProxy() : null;

/** Keeps the WorkOS session fresh; without WorkOS (demo/mock setups) it is a no-op. */
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return workos ? workos(request, event) : NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"],
};
