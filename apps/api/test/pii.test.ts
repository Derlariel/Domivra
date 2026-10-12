import { expect, test } from 'vitest'
import { decryptPersonal, encryptPersonal, maskPersonal } from '../src/pii.js'

test('encrypts identifiers and rejects tampering', () => {
  const key = 'ab'.repeat(32)
  const encrypted = encryptPersonal('1234567890123', key)
  expect(encrypted).not.toContain('1234567890123')
  expect(decryptPersonal(encrypted, key)).toBe('1234567890123')
  expect(maskPersonal('1234567890123')).toBe('••••0123')
  expect(() => decryptPersonal(encrypted, 'cd'.repeat(32))).toThrow()
})
