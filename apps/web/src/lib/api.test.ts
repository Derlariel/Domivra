import { expect, test } from 'vitest'
import { currency, statusName } from './api'

test('renders PostgreSQL decimal amounts and Thai status labels',()=>{
  expect(currency('10000.25')).toBe('฿10,000.25')
  expect(statusName('verified')).toBe('ยืนยันแล้ว')
})
