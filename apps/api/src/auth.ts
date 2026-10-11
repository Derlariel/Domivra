import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { rows, one, passwordHash, checkPassword, transaction } from './db.js'
import { config } from './config.js'

export type Role = 'platform' | 'admin' | 'resident'
export type Actor = { id: string; org_id: string | null; username: string; name: string; role: Role; unit_id: string | null; organization: string }
export const bad = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode })
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const signIn = z.object({ organization: z.string().trim().min(3), username: z.string().trim().min(1), password: z.string().min(1) })
const register = signIn.extend({ name: z.string().trim().min(1), building: z.string().trim().min(1), number: z.string().trim().min(1), invite: z.string().min(10), password: z.string().min(12) })

export async function actor(req: FastifyRequest, role?: Role): Promise<Actor> {
  const token = req.cookies.session
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw bad(401, 'กรุณาเข้าสู่ระบบ')
  const found = await one<Actor>(`SELECT u.id,u.org_id,u.username,u.name,u.role,u.unit_id,COALESCE(o.name,'Platform') organization
    FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN organizations o ON o.id=u.org_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND (u.role='platform' OR o.status='active')`, [tokenHash(token)])
  if (!found) throw bad(401, 'กรุณาเข้าสู่ระบบ')
  if (role && found.role !== role) throw bad(403, 'ไม่มีสิทธิ์ดำเนินการ')
  return found
}
export function org(actor: Actor): string {
  if (!actor.org_id) throw bad(403, 'บัญชีแพลตฟอร์มเข้าข้อมูลลูกค้าไม่ได้')
  return actor.org_id
}
export function admin(actor: Actor): string {
  if (actor.role !== 'admin') throw bad(403, 'เฉพาะผู้ดูแลลูกค้า')
  return org(actor)
}
export function resident(actor: Actor): string {
  if (actor.role !== 'resident') throw bad(403, 'เฉพาะผู้พัก')
  return org(actor)
}
export const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: config.COOKIE_SECURE === 'true', path: '/' }

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/login', async (req, reply) => {
    const data = signIn.parse(req.body)
    const user = await one<{ id: string; role: Role; password_hash: string }>(`SELECT u.id,u.role,u.password_hash FROM users u LEFT JOIN organizations o ON o.id=u.org_id
      WHERE u.username=$1 AND ((u.role='platform' AND $2='platform') OR (o.slug=$2 AND o.status='active'))`, [data.username, data.organization.toLowerCase()])
    if (!user || !(await checkPassword(data.password, user.password_hash))) throw bad(401, 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง')
    const token = randomBytes(32).toString('hex')
    await rows('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'7 days\')', [tokenHash(token), user.id])
    reply.setCookie('session', token, { ...cookieOptions, maxAge: 604800 })
    return { role: user.role }
  })
  app.post('/api/logout', async (req, reply) => {
    if (req.cookies.session) await rows('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(req.cookies.session)])
    reply.clearCookie('session', cookieOptions)
    return { ok: true }
  })
  app.get('/api/me', async req => actor(req))
  app.post('/api/register', async req => {
    const d = register.parse(req.body)
    const organization = await one<{ id: string }>('SELECT id FROM organizations WHERE slug=$1 AND status=$2', [d.organization.toLowerCase(), 'active'])
    if (!organization) throw bad(403, 'รหัสองค์กรไม่ถูกต้อง')
    const unit = await one<{ id: string; invite_hash: string; invite_expires_at: Date }>(`SELECT id,invite_hash,invite_expires_at FROM units
      WHERE org_id=$1 AND building=$2 AND number=$3 AND status='available'`, [organization.id, d.building, d.number])
    if (!unit || !unit.invite_hash || unit.invite_expires_at < new Date() || tokenHash(d.invite) !== unit.invite_hash) throw bad(403, 'รหัสเชิญหรือห้องไม่ถูกต้อง')
    return transaction(async client => {
      const claimed = await client.query('UPDATE units SET status=$1,invite_hash=NULL,invite_expires_at=NULL WHERE id=$2 AND status=$3 RETURNING id', ['occupied', unit.id, 'available'])
      if (!claimed.rowCount) throw bad(409, 'ห้องนี้มีผู้พักแล้ว')
      const created = await client.query<{ id: string }>('INSERT INTO users(org_id,username,password_hash,name,role,unit_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [organization.id, d.username, await passwordHash(d.password), d.name, 'resident', unit.id])
      return { id: created.rows[0]?.id }
    })
  })
  app.post('/api/password', async req => {
    const user = await actor(req)
    const d = z.object({ current: z.string(), next: z.string().min(12).max(128) }).parse(req.body)
    const current = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [user.id])
    if (!current || !(await checkPassword(d.current, current.password_hash))) throw bad(403, 'รหัสผ่านเดิมไม่ถูกต้อง')
    await rows('UPDATE users SET password_hash=$1 WHERE id=$2', [await passwordHash(d.next), user.id])
    await rows('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [user.id, tokenHash(req.cookies.session!)])
    return { ok: true }
  })
}
