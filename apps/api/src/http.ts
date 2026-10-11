import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { bad } from './auth.js'
export const uuid = z.string().uuid()
export function id(req: FastifyRequest): string { return uuid.parse((req.params as { id: string }).id) }
export function body(req: FastifyRequest): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw bad(400, 'รูปแบบข้อมูลไม่ถูกต้อง')
  return req.body as Record<string, unknown>
}
export function text(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw bad(400, `กรุณาระบุ${label}`)
  return value.trim()
}
export function optional(value: unknown, max = 300): string { return typeof value === 'string' ? value.trim().slice(0,max) : '' }
export function amount(value: unknown, label: string): string {
  const str = String(value ?? '')
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(str)) throw bad(400, `${label}ไม่ถูกต้อง`)
  return str
}
export function whole(value: unknown, label: string): number {
  const num = Number(value)
  if (!Number.isSafeInteger(num) || num < 0) throw bad(400, `${label}ไม่ถูกต้อง`)
  return num
}
