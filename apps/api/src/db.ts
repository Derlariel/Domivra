import pg, { type PoolClient, type QueryResultRow } from 'pg'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'

const scrypt = promisify(scryptCallback)
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL })
export async function rows<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows
}
export async function one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(sql, params))[0]
}
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scrypt(password, salt, 64) as Buffer).toString('hex')
  return `${salt}:${hash}`
}
export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(':')
  if (!salt || !expected) return false
  const { timingSafeEqual } = await import('node:crypto')
  const actual = await scrypt(password, salt, 64) as Buffer
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'))
}
export async function initializeDatabase(): Promise<void> {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations/001_init.sql')
  await pool.query(await readFile(file, 'utf8'))
  const registry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations/002_resident_registry.sql')
  await pool.query(await readFile(registry, 'utf8'))
  const datasets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations/003_customer_datasets.sql')
  await pool.query(await readFile(datasets, 'utf8'))
  const exists = await one('SELECT id FROM users WHERE role=$1 LIMIT 1', ['platform'])
  if (!exists) {
    const password = randomBytes(18).toString('base64url')
    await pool.query('INSERT INTO users(username,password_hash,name,role) VALUES($1,$2,$3,$4)', ['platform', await passwordHash(password), 'ผู้ดูแลแพลตฟอร์ม', 'platform'])
    await mkdir(config.RUNTIME_DIR, { recursive: true, mode: 0o700 })
    await writeFile(path.join(config.RUNTIME_DIR, 'platform-credentials.txt'), `organization: platform\nusername: platform\npassword: ${password}\n`, { mode: 0o600 })
  }
}
