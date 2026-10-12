import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function encryptPersonal(value: string, keyHex: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv)
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

export function decryptPersonal(value: string, keyHex: string): string {
  const data = Buffer.from(value, 'base64')
  if (data.length < 29) throw new Error('Invalid encrypted value')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
}

export function maskPersonal(value: string): string {
  return value ? `••••${value.slice(-4)}` : ''
}
