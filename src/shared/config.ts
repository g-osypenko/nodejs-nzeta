import { z } from 'zod';

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('127.0.0.1'), // loopback by default; set 0.0.0.0 explicitly in containers
    DATA_SOURCE: z.enum(['memory', 'postgres']).default('postgres'),
    DATABASE_URL: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    WEBHOOK_SECRET: z.string().min(16, 'WEBHOOK_SECRET must be at least 16 chars'),
    ADMIN_EMAIL: z.email(),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
    GIT_COMMIT: z.string().min(1).default('dev-local'),
    DEBUG_HEADERS: z.stringbool().default(false),
    WEB_DIST_DIR: z.string().min(1).optional(),
    DEBUG_RUNTIME: z.stringbool().default(false),
    // Passwordless sign-in and cookie session (ADR 0011)
    APP_BASE_URL: z
      .url()
      .transform((u) => u.replace(/\/+$/, ''))
      .optional(),
    COOKIE_SECURE: z.stringbool().default(true),
    MAILER: z.enum(['console', 'memory']).default('console'),
    LOGIN_CODE_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(10),
  })
  .refine((env) => env.DATA_SOURCE === 'memory' || env.DATABASE_URL !== undefined, {
    message: 'DATABASE_URL is required when DATA_SOURCE=postgres',
    path: ['DATABASE_URL'],
  });

export interface AppConfig {
  port: number;
  host: string;
  dataSource: 'memory' | 'postgres';
  databaseUrl: string | null;
  dbPoolMax: number;
  dbStatementTimeoutMs: number;
  webhookSecret: string;
  /** Account that exists with role ADMIN from the first start; signs in by code like everyone. */
  adminEmail: string;
  sessionTtlHours: number;
  gitCommit: string;
  /** Adds x-db-queries to responses (dev/smoke only). */
  debugHeaders: boolean;
  /** Built frontend (web/dist) served on the same origin; null = API only (ADR 0008). */
  webDistDir: string | null;
  /** Exposes GET /debug/runtime (CPU, ELU, event-loop delay, RSS) for load tests only. */
  debugRuntime: boolean;
  /**
   * Public origin of the site, e.g. https://nodejs-nzeta.onrender.com: links in sign-in emails and
   * the Origin that cookie-authenticated mutations must come from (CSRF). `null` = the request host.
   */
  appBaseUrl: string | null;
  /** `Secure` flag of the session cookie; false only for plain-http local development. */
  cookieSecure: boolean;
  /** console = letter in the log (development); memory = in-process outbox (tests, smoke). */
  mailer: 'console' | 'memory';
  loginCodeTtlMinutes: number;
}

/** Validates the environment once at startup; an invalid env fails the process immediately. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    host: e.HOST,
    dataSource: e.DATA_SOURCE,
    databaseUrl: e.DATABASE_URL ?? null,
    dbPoolMax: e.DB_POOL_MAX,
    dbStatementTimeoutMs: e.DB_STATEMENT_TIMEOUT_MS,
    webhookSecret: e.WEBHOOK_SECRET,
    adminEmail: e.ADMIN_EMAIL.toLowerCase(),
    sessionTtlHours: e.SESSION_TTL_HOURS,
    gitCommit: e.GIT_COMMIT,
    debugHeaders: e.DEBUG_HEADERS,
    webDistDir: e.WEB_DIST_DIR ?? null,
    debugRuntime: e.DEBUG_RUNTIME,
    appBaseUrl: e.APP_BASE_URL ?? null,
    cookieSecure: e.COOKIE_SECURE,
    mailer: e.MAILER,
    loginCodeTtlMinutes: e.LOGIN_CODE_TTL_MINUTES,
  };
}
