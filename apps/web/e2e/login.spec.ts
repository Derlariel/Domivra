import { expect, test } from '@playwright/test'

test('login and room invite entry are available on mobile', async ({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('/login')
  await expect(page.getByRole('heading',{name:'เข้าสู่ระบบ'})).toBeVisible()
  await expect(page.getByLabel('รหัสองค์กร')).toBeEmpty()
  await expect(page.getByText('แอดมิน Domivra ใช้รหัสองค์กร platform', {exact:false})).toBeVisible()
  await page.getByRole('button',{name:'ลงทะเบียนด้วยรหัสเชิญห้องพัก'}).click()
  await expect(page.getByRole('dialog',{name:'ลงทะเบียนห้องพัก'})).toBeVisible()
})
