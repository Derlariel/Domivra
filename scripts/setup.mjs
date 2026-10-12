import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root=path.resolve(import.meta.dirname,'..')
let existing=''
try { existing=await readFile(path.join(root,'.env'),'utf8') } catch {}
const values=Object.fromEntries(existing.split('\n').map(line=>line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(match=>[match[1],match[2]]))
const random=()=>randomBytes(24).toString('hex')
const chosen=(value,fallback)=>value&&!value.startsWith('replace-with-')?value:fallback()
const config={
  POSTGRES_PASSWORD:chosen(values.POSTGRES_PASSWORD,random),
  S3_ACCESS_KEY:chosen(values.S3_ACCESS_KEY||values.MINIO_ROOT_USER,()=>`domivra${randomBytes(8).toString('hex')}`),
  S3_SECRET_KEY:chosen(values.S3_SECRET_KEY||values.MINIO_ROOT_PASSWORD,random),
  S3_SSE_KEK:chosen(values.S3_SSE_KEK,()=>randomBytes(32).toString('hex')),
  PII_ENCRYPTION_KEY:chosen(values.PII_ENCRYPTION_KEY,()=>randomBytes(32).toString('hex')),
  LLM_PROVIDER:values.LLM_PROVIDER||'disabled',
  LLM_BASE_URL:values.LLM_BASE_URL||'',
  LLM_API_KEY:values.LLM_API_KEY||'',
  LLM_MODEL:values.LLM_MODEL||'',
}
await writeFile(path.join(root,'.env'),Object.entries(config).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{mode:0o600})
await mkdir(path.join(root,'runtime'),{recursive:true,mode:0o700})
await writeFile(path.join(root,'runtime/s3.json'),JSON.stringify({identities:[{name:'domivra',credentials:[{accessKey:config.S3_ACCESS_KEY,secretKey:config.S3_SECRET_KEY}],actions:['Admin','Read','List','Tagging','Write']}]}),{mode:0o600})
console.log('ตั้งค่าฐานข้อมูลและพื้นที่ไฟล์ส่วนตัวแล้ว')
