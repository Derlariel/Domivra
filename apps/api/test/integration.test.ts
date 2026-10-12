import { afterAll, expect, test } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import ExcelJS from 'exceljs'

let database: StartedPostgreSqlContainer | undefined, server: ChildProcess | undefined, runtime = ''
afterAll(async () => { server?.kill('SIGTERM'); if(database) await database.stop(); if(runtime) await rm(runtime,{recursive:true,force:true}) })

test.skipIf(!process.env.CI && !process.env.RUN_INTEGRATION)('separates organizations and consumes a room invite once', async () => {
  database=await new PostgreSqlContainer('postgres:17-alpine').start()
  runtime=await mkdtemp(path.join(tmpdir(),'domivra-test-'))
  const port=39451, base=`http://127.0.0.1:${port}`
  const apiDir=path.resolve(import.meta.dirname,'..'),serverEnv={...process.env,DATABASE_URL:database.getConnectionUri(),API_PORT:String(port),WEB_ORIGIN:'http://127.0.0.1:5173',S3_ACCESS_KEY:'test',S3_SECRET_KEY:'test',PII_ENCRYPTION_KEY:'ab'.repeat(32),RUNTIME_DIR:runtime}
  server=spawn(process.execPath,['dist/main.js'],{cwd:apiDir,env:serverEnv,stdio:'ignore'})
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok)break}catch{}await delay(200)}
  const credentials=await readFile(path.join(runtime,'platform-credentials.txt'),'utf8')
  const platformPassword=credentials.match(/^password: (.+)$/m)?.[1]
  expect(platformPassword).toBeTruthy()
  const request=async(method:string,url:string,data?:unknown,cookie?:string)=>{
    const response=await fetch(base+url,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)})
    return {status:response.status,data:await response.json() as Record<string,unknown>,cookie:response.headers.get('set-cookie')?.split(';')[0]||''}
  }
  const signed=await request('POST','/api/login',{organization:'platform',username:'platform',password:platformPassword})
  expect(signed.status).toBe(200)
  const orgA=await request('POST','/api/organizations',{slug:'alpha',name:'Alpha',admin_name:'Admin A',username:'admin'},signed.cookie)
  const orgB=await request('POST','/api/organizations',{slug:'beta',name:'Beta',admin_name:'Admin B',username:'admin'},signed.cookie)
  expect(orgA.status).toBe(200);expect(orgB.status).toBe(200)
  const a=(await request('POST','/api/login',{organization:'alpha',username:'admin',password:orgA.data.password})).cookie
  const b=(await request('POST','/api/login',{organization:'beta',username:'admin',password:orgB.data.password})).cookie
  const owner=await request('POST',`/api/organizations/${orgA.data.id}/owners`,{name:'Owner A',username:'owner'},signed.cookie)
  expect(owner.status).toBe(200)
  expect((await request('POST',`/api/organizations/${orgA.data.id}/owners`,{name:'Other',username:'other'},b)).status).toBe(403)
  expect((await request('POST',`/api/owners/${owner.data.id}/reset-password`,{},b)).status).toBe(403)
  const managed=await request('GET','/api/organizations',undefined,signed.cookie)
  expect((managed.data as unknown as Array<{slug:string;owners:Array<{username:string}>}>).find(x=>x.slug==='alpha')?.owners.map(x=>x.username)).toContain('owner')
  const ownerSession=(await request('POST','/api/login',{organization:'alpha',username:'owner',password:owner.data.password})).cookie
  expect((await request('GET','/api/organizations',undefined,ownerSession)).status).toBe(403)
  const reset=await request('POST',`/api/owners/${owner.data.id}/reset-password`,{},signed.cookie)
  expect(reset.status).toBe(200)
  expect((await request('GET','/api/me',undefined,ownerSession)).status).toBe(401)
  expect((await request('POST','/api/login',{organization:'alpha',username:'owner',password:owner.data.password})).status).toBe(401)
  expect((await request('POST','/api/login',{organization:'alpha',username:'owner',password:reset.data.password})).status).toBe(200)
  expect((await request('POST','/api/password',{current:platformPassword,next:'new-platform-password-123'},signed.cookie)).status).toBe(200)
  expect((await request('POST','/api/login',{organization:'platform',username:'platform',password:platformPassword})).status).toBe(401)
  const property=await request('POST','/api/properties',{name:'A House',address:'Bangkok'},a)
  const unit=await request('POST','/api/units',{property_id:property.data.id,building:'A',number:'101',floor:1,rent:'10000.25',deposit:'20000.00'},a)
  expect(unit.status).toBe(200)
  const invite=await request('POST',`/api/units/${unit.data.id}/invite`,{},a)
  const register={organization:'alpha',building:'A',number:'101',invite:invite.data.invite,name:'Resident A',username:'room101',password:'A-strong-passphrase-123'}
  const registered=await request('POST','/api/register',register)
  expect(registered.status).toBe(200)
  expect((await request('POST','/api/register',register)).status).toBe(403)
  expect((await request('GET','/api/units',undefined,b)).data).toEqual([])
  expect((await request('POST',`/api/units/${unit.data.id}/invite`,{},b)).status).toBe(409)
  expect((await request('GET',`/api/residents/${registered.data.id}/profile`,undefined,b)).status).toBe(404)
  expect((await request('PATCH','/api/settings',{privacy_purpose:'ดูแลสัญญาและความปลอดภัยของอาคาร',retention_days:365},a)).status).toBe(200)
  const residentCookie=(await request('POST','/api/login',{organization:'alpha',username:'room101',password:register.password})).cookie
  expect((await request('POST','/api/my/privacy',{accepted:true},residentCookie)).status).toBe(200)
  expect((await request('PATCH','/api/my/profile',{phone:'0812345678',emergency_name:'Relative A',emergency_phone:'0899999999'},residentCookie)).status).toBe(200)
  expect((await request('PATCH','/api/my/profile',{phone:'0812345678',nationality:'changed',move_out_date:'2020-01-01'},residentCookie)).status).toBe(200)
  const ownProfile=await request('GET','/api/my/profile',undefined,residentCookie)
  expect(ownProfile.data.nationality).toBe('')
  expect(ownProfile.data.move_out_date).toBeNull()
  expect((await request('POST',`/api/residents/${registered.data.id}/identity`,{type:'thai_id',number:'1234567890123'},a)).status).toBe(200)
  const profile=await request('GET',`/api/residents/${registered.data.id}/profile`,undefined,a)
  expect(profile.data.identity_masked).toBe('••••0123')
  expect(JSON.stringify(profile.data)).not.toContain('1234567890123')
  expect((await request('GET',`/api/residents/${registered.data.id}/identity`,undefined,residentCookie)).status).toBe(403)
  expect((await request('GET',`/api/residents/${registered.data.id}/identity`,undefined,a)).data.number).toBe('1234567890123')
  const csv='property,building,number,floor,rent,deposit,area,owner_name,owner_phone\nSecond House,B,B-201,2,7000,14000,28,Owner Two,0800000000\n'
  const imported=await request('POST','/api/import/parse',{filename:'rooms.csv',file:'data:text/csv;base64,'+Buffer.from(csv).toString('base64')},a)
  expect(imported.status).toBe(200)
  expect((await request('POST','/api/import/confirm',imported.data,a)).status).toBe(200)
  expect((await request('GET','/api/units',undefined,a)).data).toMatchObject(expect.arrayContaining([expect.objectContaining({owner_name:'Owner Two',owner_phone:'0800000000'})]))
  const custom='เลขห้อง,ข้อมูลตามโครงการ,รหัสภายใน\nA-101,พื้นที่พิเศษ,X-01\n'
  const customParsed=await request('POST','/api/datasets/parse',{filename:'custom.csv',file:'data:text/csv;base64,'+Buffer.from(custom).toString('base64')},a)
  expect(customParsed.status).toBe(200)
  const customSaved=await request('POST','/api/datasets/confirm',customParsed.data,a)
  expect(customSaved.status).toBe(200)
  const datasetId=(customSaved.data.ids as string[])[0]!
  const detail=await request('GET',`/api/datasets/${datasetId}`,undefined,a)
  expect(detail.data.headers).toEqual(['เลขห้อง','ข้อมูลตามโครงการ','รหัสภายใน'])
  expect(detail.data.rows).toMatchObject([{row_number:1,values:['A-101','พื้นที่พิเศษ','X-01']}])
  expect((await request('GET',`/api/datasets/${datasetId}`,undefined,b)).status).toBe(404)
  expect((await request('DELETE',`/api/datasets/${datasetId}`,undefined,b)).status).toBe(404)
  expect((await request('DELETE',`/api/datasets/${datasetId}`,undefined,a)).status).toBe(200)
  expect((await request('PATCH','/api/settings',{import_retention_days:30},a)).status).toBe(200)
  const dataset=async(filename:string,csv:string)=>{
    const parsed=await request('POST','/api/datasets/parse',{filename,file:'data:text/csv;base64,'+Buffer.from(csv).toString('base64')},a)
    expect(parsed.status).toBe(200)
    const saved=await request('POST','/api/datasets/confirm',parsed.data,a)
    expect(saved.status).toBe(200)
    return (saved.data.ids as string[])[0]!
  }
  const mappedUnits=await dataset('rooms-custom.csv','ห้อง,อาคาร,โครงการ,ค่าเช่า\nB-301,C,Third House,8000\n')
  const roomsMap={target:'units',mapping:{number:'ห้อง',building:'อาคาร',property:'โครงการ',rent:'ค่าเช่า'}}
  expect((await request('POST',`/api/datasets/${mappedUnits}/mapping/preview`,roomsMap,b)).status).toBe(404)
  expect((await request('POST',`/api/datasets/${mappedUnits}/mapping/preview`,roomsMap,a)).data).toMatchObject({created:1,skipped:0,error_count:0})
  expect((await request('POST',`/api/datasets/${mappedUnits}/mapping/confirm`,roomsMap,a)).data).toMatchObject({created:1,error_count:0})
  expect((await request('POST',`/api/datasets/${mappedUnits}/mapping/preview`,roomsMap,a)).data).toMatchObject({created:0,skipped:1})
  const invalidRooms=await dataset('invalid-rooms.csv','ห้อง,ชั้น\nX-101,1\nX-102,-1\n')
  const invalidMap={target:'units',mapping:{number:'ห้อง',floor:'ชั้น'}}
  expect((await request('POST',`/api/datasets/${invalidRooms}/mapping/preview`,invalidMap,a)).data).toMatchObject({created:1,error_count:1})
  expect((await request('POST',`/api/datasets/${invalidRooms}/mapping/confirm`,invalidMap,a)).status).toBe(409)
  expect(JSON.stringify((await request('GET','/api/units',undefined,a)).data)).not.toContain('X-101')
  const mappedResidents=await dataset('residents-custom.csv','เลขห้อง,ชื่อผู้พัก\nB-301,Resident C\n')
  const residentsMap={target:'residents',mapping:{number:'เลขห้อง',name:'ชื่อผู้พัก'}}
  expect((await request('POST',`/api/datasets/${mappedResidents}/mapping/preview`,residentsMap,a)).data).toMatchObject({created:1,error_count:0})
  const residentsResult=await request('POST',`/api/datasets/${mappedResidents}/mapping/confirm`,residentsMap,a)
  expect(residentsResult.status).toBe(200)
  const newResident=(residentsResult.data.credentials as Array<{username:string;password:string}>)[0]!
  expect((await request('POST','/api/login',{organization:'alpha',...newResident})).status).toBe(200)
  const mappedContracts=await dataset('contracts-custom.csv','เลขห้อง,เริ่ม,สิ้นสุด\nB-301,2026-01-01,2027-01-01\n')
  const contractsMap={target:'contracts',mapping:{number:'เลขห้อง',start_date:'เริ่ม',end_date:'สิ้นสุด'}}
  expect((await request('POST',`/api/datasets/${mappedContracts}/mapping/preview`,contractsMap,a)).data).toMatchObject({created:1,error_count:0})
  expect((await request('POST',`/api/datasets/${mappedContracts}/mapping/confirm`,contractsMap,a)).status).toBe(200)
  const mappedInvoices=await dataset('invoices-custom.csv','เลขห้อง,งวด,กำหนด\nB-301,2026-11,2026-11-05\n')
  const invoicesMap={target:'invoices',mapping:{number:'เลขห้อง',period:'งวด',due:'กำหนด'}}
  expect((await request('POST',`/api/datasets/${mappedInvoices}/mapping/preview`,invoicesMap,a)).data).toMatchObject({created:1,error_count:0})
  expect((await request('POST',`/api/datasets/${mappedInvoices}/mapping/confirm`,invoicesMap,a)).status).toBe(200)
  expect((await request('GET','/api/invoices',undefined,a)).data).toMatchObject(expect.arrayContaining([expect.objectContaining({period:'2026-11',status:'draft'})]))
  const expiring=await request('GET',`/api/datasets/${mappedInvoices}`,undefined,a)
  expect(new Date(String(expiring.data.expires_at)).getTime()).toBeGreaterThan(Date.now()+25*86_400_000)
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('วันสัญญา')
  sheet.addRow(['วันที่']);sheet.addRow([new Date('2026-01-01T00:00:00.000Z')])
  const xlsx=await request('POST','/api/datasets/parse',{filename:'dates.xlsx',file:'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'+Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')},a)
  expect(xlsx.status).toBe(200)
  expect((xlsx.data.sheets as Array<{rows:string[][]}>)[0]?.rows[0]?.[0]).toBe('2026-01-01T00:00:00.000Z')
  const recovery=spawnSync(process.execPath,['dist/reset-platform.js'],{cwd:apiDir,env:serverEnv,encoding:'utf8'})
  expect(recovery.status).toBe(0)
  const recovered=await readFile(path.join(runtime,'platform-credentials.txt'),'utf8')
  const recoveredPassword=recovered.match(/^password: (.+)$/m)?.[1]
  expect(recoveredPassword).toBeTruthy()
  expect((await request('POST','/api/login',{organization:'platform',username:'platform',password:recoveredPassword})).status).toBe(200)
  expect((await request('POST','/api/login',{organization:'platform',username:'platform',password:'new-platform-password-123'})).status).toBe(401)
  const databaseClient=new pg.Client({connectionString:database.getConnectionUri()})
  await databaseClient.connect()
  await databaseClient.query("UPDATE customer_datasets SET expires_at=now()-interval '1 day' WHERE id=$1",[mappedInvoices])
  await databaseClient.end()
  const cleanup=spawnSync(process.execPath,['--input-type=module','-e',"import('./dist/retention.js').then(async m=>{await m.purgeExpiredDatasets();const {pool}=await import('./dist/db.js');await pool.end()})"],{cwd:apiDir,env:serverEnv,encoding:'utf8'})
  expect(cleanup.status).toBe(0)
  expect((await request('GET',`/api/datasets/${mappedInvoices}`,undefined,a)).status).toBe(404)
},120_000)
