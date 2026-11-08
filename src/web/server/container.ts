import "server-only";
import { createContainer, type Container } from "@/infrastructure/container";

const globalForContainer = globalThis as unknown as { concorraWeb?: Container };

/** One container per server process (survives dev hot reloads). */
export function getContainer(): Container {
  globalForContainer.concorraWeb ??= createContainer("web");
  return globalForContainer.concorraWeb;
}

export function getDeps() {
  return getContainer().deps;
}
