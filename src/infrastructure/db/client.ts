import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export type Db = PrismaClient;

export function createPrisma(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
