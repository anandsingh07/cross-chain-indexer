import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  API_BASE_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  DATABASE_URL: z.string().url(),
  
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  
  RPC_WS_URL_SEPOLIA: z.string().url(),
  RPC_HTTP_URL_SEPOLIA: z.string().url(),
  
  RPC_WS_URL_BASE_SEPOLIA: z.string().url(),
  RPC_HTTP_URL_BASE_SEPOLIA: z.string().url(),
  
  PYTH_HERMES_URL: z.string().url().default('https://hermes.pyth.network'),
  
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000), // 15 mins
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Redis Streams transport (bounded in-flight buffer between ingestion and enrichment).
  STREAM_MAXLEN: z.coerce.number().default(50_000),
  CONSUMER_CONCURRENCY: z.coerce.number().default(4),
  // If true (default), the listener publishes to the stream and a separate consumer process
  // enriches+persists. If false, falls back to the legacy in-process direct call.
  USE_STREAMING: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_CHAT_ID: z.string().optional().default(''),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;
export type Env = z.infer<typeof envSchema>;
