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
  // Run BullMQ workers inside the api process (single-service platforms like
  // Koyeb's free tier). Keep false in multi-service deployments.
  SINGLE_PROCESS: z.coerce.boolean().default(false),
  // Extra allowed CORS origins, comma-separated (e.g. your Vercel domains).
  CORS_ORIGINS: z.string().default(""),
});

const parsed = envSchema.parse(process.env);

const DEV_JWT_SECRET = "dev-secret-change-me";
const isProduction =
  process.env.NODE_ENV === "production" || process.env.NODE_ENV === "prod";

if (isProduction && (parsed.JWT_SECRET === DEV_JWT_SECRET || parsed.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be set to a strong value in production");
}

export const config = {
  DATABASE_URL: parsed.DATABASE_URL,
  REDIS_URL: parsed.REDIS_URL,
  JWT_SECRET: parsed.JWT_SECRET,
  PORT: parsed.PORT,
  LOG_LEVEL: parsed.LOG_LEVEL,
  SINGLE_PROCESS: parsed.SINGLE_PROCESS,
  IS_PRODUCTION: isProduction,
  CORS_ORIGINS: parsed.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export type Config = typeof config;
