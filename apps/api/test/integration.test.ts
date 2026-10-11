import { afterAll, expect, test } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

let database: StartedPostgreSqlContainer | undefined, server: ChildProcess | undefined, runtime = ''
afterAll(async () => { server?.kill('SIGTERM'); if(database) await database.stop(); if(runtime) await rm(runtime,{recursive:true,force:true}) })

test.skipIf(!process.env.CI && !process.env.RUN_INTEGRATION)('separates organizations and consumes a room invite once', async () => {
  database=await new PostgreSqlContainer('postgres:17-alpine').start()
  runtime=await mkdtemp(path.join(tmpdir(),'domivra-test-'))
  const port=39451, base=`http://127.0.0.1:${port}`
  server=spawn(process.execPath,['dist/main.js'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,DATABASE_URL:database.getConnectionUri(),API_PORT:String(port),WEB_ORIGIN:'http://127.0.0.1:5173',S3_ACCESS_KEY:'test',S3_SECRET_KEY:'test',RUNTIME_DIR:runtime},stdio:'ignore'})
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok)break}catch{}await delay(200)}
  const credentials=await readFile(path.join(runtime,'platform-credentials.txt'),'utf8')
  const platformPassword=credentials.match(/^password: (.+)$/m)?.[1]
  expect(platformPassword).toBeTruthy()
  const request=async(method:string,url:string,data?:unknown,cookie?:string)=>{
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)})
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
  expect((await request('POST','/api/register',register)).status).toBe(200)
  expect((await request('POST','/api/register',register)).status).toBe(403)
  expect((await request('GET','/api/units',undefined,b)).data).toEqual([])
  expect((await request('POST',`/api/units/${unit.data.id}/invite`,{},b)).status).toBe(409)
},120_000)
