import { expect, test } from '@playwright/test'

test('owner reviews column mapping before creating rooms', async ({page})=>{
  const datasetId='11111111-1111-4111-8111-111111111111'
  await page.route('**/api/me',route=>route.fulfill({json:{id:'22222222-2222-4222-8222-222222222222',username:'owner',name:'Owner',role:'admin',unit_id:null,organization:'Demo House'}}))
  await page.route('**/api/events',route=>route.abort())
  await page.route('**/api/datasets',route=>route.fulfill({json:[{id:datasetId,name:'Demo data',filename:'demo.csv',row_count:1,created_at:'2026-10-12T00:00:00Z',expires_at:'2027-10-12T00:00:00Z'}]}))
  await page.route(`**/api/datasets/${datasetId}?offset=0`,route=>route.fulfill({json:{id:datasetId,name:'Demo data',filename:'demo.csv',row_count:1,created_at:'2026-10-12T00:00:00Z',expires_at:'2027-10-12T00:00:00Z',headers:['เลขห้อง','ค่าเช่า'],rows:[{row_number:1,values:['A-101','6500']}]}}))
  await page.route(`**/api/datasets/${datasetId}/mapping/preview`,async route=>{
    expect(route.request().postDataJSON()).toMatchObject({target:'units',mapping:{number:'เลขห้อง',rent:'ค่าเช่า'}})
    await route.fulfill({json:{created:1,skipped:0,error_count:0,errors:[]}})
  })
  await page.route(`**/api/datasets/${datasetId}/mapping/confirm`,route=>route.fulfill({json:{created:1,skipped:0,error_count:0,errors:[],credentials:[]}}))
  await page.goto('/owner/datasets')
  await page.getByRole('button',{name:/Demo data/}).click()
  await page.getByLabel('เลขห้อง *').selectOption('เลขห้อง')
  await page.getByLabel('ค่าเช่า').selectOption('ค่าเช่า')
  await page.getByRole('button',{name:'ตรวจรายการก่อนสร้าง'}).click()
  await expect(page.getByText('สร้างใหม่ 1')).toBeVisible()
  page.on('dialog',dialog=>dialog.accept())
  await page.getByRole('button',{name:'ยืนยันสร้างรายการจริง'}).click()
  await expect(page.getByText('สร้าง 1 รายการ ข้ามรายการเดิม 0 รายการแล้ว')).toBeVisible()
})
