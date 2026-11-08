import { Prisma } from "./generated/client";

export const json = (v: unknown) => v as Prisma.InputJsonValue;
export const jsonOrNull = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));
