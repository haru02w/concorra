import "server-only";
import { ApiError } from "./api";
import { getContainer } from "./container";

/** Mock-only endpoints answer 404 unless MOCK_EXTERNAL=true. */
export function requireMockMode() {
  const container = getContainer();
  if (!container.env.MOCK_EXTERNAL || !container.outbox) throw new ApiError(404, "not_found", "Not found");
  return { ...container, outbox: container.outbox };
}
