import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://gcm:gcm-dev-password@localhost:5432/gamingcafe"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().default("dev-secret-change-me"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

const parsed = envSchema.parse(process.env);

export const config = {
  DATABASE_URL: parsed.DATABASE_URL,
  REDIS_URL: parsed.REDIS_URL,
  JWT_SECRET: parsed.JWT_SECRET,
  PORT: parsed.PORT,
  LOG_LEVEL: parsed.LOG_LEVEL,
} as const;

export type Config = typeof config;
