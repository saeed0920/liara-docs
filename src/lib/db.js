import { PrismaClient } from "@prisma/client";

// Reuse a single client across hot reloads / serverless invocations.
const g = globalThis;
export const db = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = db;

// Singleton config row. id fixed to 1.
export async function getConfig() {
  return db.config.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}
