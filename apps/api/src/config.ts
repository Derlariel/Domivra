import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
  COOKIE_SECURE: z.string().default('false'),
  S3_ENDPOINT: z.string().url().default('http://127.0.0.1:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('domivra-private'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  PII_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  AI_URL: z.string().url().default('http://127.0.0.1:8000'),
  RUNTIME_DIR: z.string().default('./runtime'),
})
export const config = schema.parse(process.env)
