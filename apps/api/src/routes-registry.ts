import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { actor, admin, bad, resident } from './auth.js'
import { one, rows } from './db.js'
import { body, id, text } from './http.js'
import { config } from './config.js'
import { decryptPersonal, encryptPersonal, maskPersonal } from './pii.js'
import { fileDataUrl, getPrivate, putPrivate, removePrivate } from './storage.js'

const short = z.string().trim().max(120).default('')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value)
const date = z.union([isoDate, z.literal('')]).default('')
const profileInput = z.object({
  nationality: short, phone: short, email: z.union([z.string().email(), z.literal('')]).default(''), line_id: short,
  emergency_name: short, emergency_relationship: short, emergency_phone: short,
  occupants: z.array(z.object({ name: short, relationship: short })).max(20).default([]),
  pets: z.array(z.object({ type: short, count: z.number().int().min(1).max(20) })).max(10).default([]),
  vehicles: z.array(z.object({ plate: short, parking: short })).max(10).default([]),
  access_items: z.array(z.object({ code: short, issued_at: date, returned_at: date })).max(20).default([]),
  authorized_people: z.array(z.object({ name: short, phone: short })).max(20).default([]),
  move_in_date: date,
})
type Subject = { id: string; org_id: string }
async function subject(req: FastifyRequest, orgId: string): Promise<Subject> {
  const found = await one<Subject>('SELECT id,org_id FROM users WHERE id=$1 AND org_id=$2 AND role=$3',[id(req),orgId,'resident'])
  if (!found) throw bad(404,'ไม่พบผู้พักในองค์กรนี้')
  return found
}
async function privacy(orgId: string): Promise<{purpose:string;days:number;version:string}> {
  const values = await rows<{key:string;value:string}>("SELECT key,value FROM settings WHERE org_id=$1 AND key IN ('privacy_purpose','retention_days')",[orgId])
  const settings = Object.fromEntries(values.map(x=>[x.key,x.value]))
  const purpose = settings.privacy_purpose || '', days = Number(settings.retention_days)
  if (!purpose || !Number.isSafeInteger(days) || days<1 || days>3650) throw bad(409,'กรุณาตั้งวัตถุประสงค์และระยะเก็บข้อมูลของหอพักก่อน')
  return {purpose,days,version:createHash('sha256').update(`${purpose}|${days}`).digest('hex')}
}
async function consent(userId: string, orgId: string): Promise<void> {
  const setting = await privacy(orgId)
  const accepted = await one('SELECT user_id FROM resident_profiles WHERE user_id=$1 AND org_id=$2 AND consent_at IS NOT NULL AND privacy_notice_version=$3',[userId,orgId,setting.version])
  if (!accepted) throw bad(409,'ผู้พักยังไม่ยืนยันประกาศความเป็นส่วนตัวฉบับปัจจุบัน')
}
async function profile(userId:string,orgId:string) {
  const found = await one<Record<string,unknown>>(`SELECT u.id user_id,u.name,u.username,un.id unit_id,un.number,un.building,un.floor,un.owner_name,un.owner_phone,
    c.start_date,c.end_date,c.rent,c.deposit,c.id contract_id,p.*
    FROM users u LEFT JOIN units un ON un.id=u.unit_id AND un.org_id=u.org_id
    LEFT JOIN LATERAL (SELECT id,start_date,end_date,rent,deposit FROM contracts WHERE user_id=u.id AND org_id=u.org_id AND status='active' ORDER BY start_date DESC LIMIT 1) c ON true
    LEFT JOIN resident_profiles p ON p.user_id=u.id AND p.org_id=u.org_id
    WHERE u.id=$1 AND u.org_id=$2 AND u.role='resident'`,[userId,orgId])
  if (!found) throw bad(404,'ไม่พบผู้พัก')
  const {identity_ciphertext,visa_ciphertext,identity_document_key,authorization_document_key,...safe}=found
  return {...safe,identity_masked:maskPersonal(String(found.identity_last4||'')),has_visa:!!visa_ciphertext,
    has_identity_document:!!identity_document_key,has_authorization_document:!!authorization_document_key}
}
async function saveProfile(userId:string,orgId:string,actorId:string,input:unknown): Promise<void> {
  await consent(userId,orgId)
  const p=profileInput.parse(input)
  await rows(`INSERT INTO resident_profiles(user_id,org_id,nationality,phone,email,line_id,emergency_name,emergency_relationship,emergency_phone,
    occupants,pets,vehicles,access_items,authorized_people,move_in_date,recorded_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT(user_id) DO UPDATE SET nationality=EXCLUDED.nationality,phone=EXCLUDED.phone,email=EXCLUDED.email,line_id=EXCLUDED.line_id,
    emergency_name=EXCLUDED.emergency_name,emergency_relationship=EXCLUDED.emergency_relationship,emergency_phone=EXCLUDED.emergency_phone,
    occupants=EXCLUDED.occupants,pets=EXCLUDED.pets,vehicles=EXCLUDED.vehicles,access_items=EXCLUDED.access_items,
    authorized_people=EXCLUDED.authorized_people,move_in_date=EXCLUDED.move_in_date,
    recorded_by=EXCLUDED.recorded_by,updated_at=now()`,[userId,orgId,p.nationality,p.phone,p.email,p.line_id,p.emergency_name,p.emergency_relationship,p.emergency_phone,
      JSON.stringify(p.occupants),JSON.stringify(p.pets),JSON.stringify(p.vehicles),JSON.stringify(p.access_items),JSON.stringify(p.authorized_people),
      p.move_in_date||null,actorId])
}

export function registerRegistryRoutes(app: FastifyInstance): void {
  app.get('/api/my/privacy', async req => {
    const user=await actor(req),orgId=resident(user),setting=await privacy(orgId)
    const current=await one<{privacy_notice_version:string;consent_at:Date}>('SELECT privacy_notice_version,consent_at FROM resident_profiles WHERE user_id=$1 AND org_id=$2',[user.id,orgId])
    return {...setting,accepted:!!current?.consent_at&&current.privacy_notice_version===setting.version,accepted_at:current?.consent_at||null}
  })
  app.post('/api/my/privacy', async req => {
    const user=await actor(req),orgId=resident(user),setting=await privacy(orgId)
    if (body(req).accepted!==true) throw bad(400,'กรุณายืนยันการรับทราบและความยินยอม')
    await rows(`INSERT INTO resident_profiles(user_id,org_id,consent_at,privacy_notice_version,recorded_by) VALUES($1,$2,now(),$3,$1)
      ON CONFLICT(user_id) DO UPDATE SET consent_at=now(),privacy_notice_version=EXCLUDED.privacy_notice_version,updated_at=now(),recorded_by=$1`,[user.id,orgId,setting.version])
    return {ok:true}
  })
  app.get('/api/my/profile', async req => {const user=await actor(req);return profile(user.id,resident(user))})
  app.patch('/api/my/profile', async req => {
    const user=await actor(req),orgId=resident(user),p=body(req)
    const current=await one<Record<string,unknown>>('SELECT * FROM resident_profiles WHERE user_id=$1 AND org_id=$2',[user.id,orgId])
    const dates={move_in_date:current?.move_in_date?new Date(String(current.move_in_date)).toISOString().slice(0,10):''}
    const own=Object.fromEntries(['phone','email','line_id','emergency_name','emergency_relationship','emergency_phone'].filter(key=>key in p).map(key=>[key,p[key]]))
    await saveProfile(user.id,orgId,user.id,{...current,...dates,...own})
    return {ok:true}
  })
  app.get('/api/residents/:id/profile', async req => {
    const orgId=admin(await actor(req)),user=await subject(req,orgId)
    return profile(user.id,orgId)
  })
  app.patch('/api/residents/:id/profile', async req => {
    const owner=await actor(req),orgId=admin(owner),user=await subject(req,orgId)
    await saveProfile(user.id,orgId,owner.id,body(req))
    return {ok:true}
  })
  app.post('/api/residents/:id/identity', async req => {
    const orgId=admin(await actor(req)),user=await subject(req,orgId),d=body(req)
    await consent(user.id,orgId)
    const kind=text(d.type,'ประเภทเอกสาร',20),number=text(d.number,'เลขเอกสาร',30).toUpperCase()
    if (kind==='thai_id'?!/^\d{13}$/.test(number):kind==='passport'?!/^[A-Z0-9]{5,20}$/.test(number):true) throw bad(400,'เลขเอกสารไม่ถูกต้อง')
    const visa=typeof d.visa_number==='string'?d.visa_number.trim().slice(0,40):''
    const expiry=d.visa_expiry===''||d.visa_expiry==null?null:isoDate.parse(d.visa_expiry)
    await rows(`UPDATE resident_profiles SET identity_type=$1,identity_ciphertext=$2,identity_last4=$3,visa_ciphertext=$4,visa_expiry=$5,updated_at=now()
      WHERE user_id=$6 AND org_id=$7`,[kind,encryptPersonal(number,config.PII_ENCRYPTION_KEY),number.slice(-4),
      visa?encryptPersonal(visa,config.PII_ENCRYPTION_KEY):'',expiry,user.id,orgId])
    return {ok:true}
  })
  app.get('/api/residents/:id/identity', async req => {
    const owner=await actor(req),orgId=admin(owner),user=await subject(req,orgId)
    const p=await one<{identity_type:string;identity_ciphertext:string;visa_ciphertext:string;visa_expiry:Date|null}>('SELECT identity_type,identity_ciphertext,visa_ciphertext,visa_expiry FROM resident_profiles WHERE user_id=$1 AND org_id=$2',[user.id,orgId])
    if (!p?.identity_ciphertext) throw bad(404,'ยังไม่มีข้อมูลเอกสาร')
    await rows('INSERT INTO audit_events(org_id,actor_id,target_id,method,route,status) VALUES($1,$2,$3,$4,$5,$6)',[orgId,owner.id,user.id,'GET','/api/residents/:id/identity',200])
    return {type:p.identity_type,number:decryptPersonal(p.identity_ciphertext,config.PII_ENCRYPTION_KEY),
      visa_number:p.visa_ciphertext?decryptPersonal(p.visa_ciphertext,config.PII_ENCRYPTION_KEY):'',visa_expiry:p.visa_expiry}
  })
  app.post('/api/residents/:id/documents/:kind', async req => {
    const orgId=admin(await actor(req)),user=await subject(req,orgId)
    await consent(user.id,orgId)
    const kind=String((req.params as {kind:string}).kind)
    if (!['identity','authorization'].includes(kind)) throw bad(400,'ชนิดเอกสารไม่ถูกต้อง')
    const file=fileDataUrl(body(req).file),column=kind==='identity'?'identity_document_key':'authorization_document_key'
    const old=await one<Record<string,string>>(`SELECT ${column} FROM resident_profiles WHERE user_id=$1 AND org_id=$2`,[user.id,orgId])
    const key=await putPrivate(orgId,kind,file)
    try {await rows(`UPDATE resident_profiles SET ${column}=$1,updated_at=now() WHERE user_id=$2 AND org_id=$3`,[key,user.id,orgId])}
    catch(error){await removePrivate(key);throw error}
    if(old?.[column])await removePrivate(old[column])
    return {ok:true}
  })
  app.get('/api/residents/:id/documents/:kind', async(req,reply)=>{
    const owner=await actor(req),orgId=admin(owner),user=await subject(req,orgId)
    const kind=String((req.params as {kind:string}).kind)
    if (!['identity','authorization'].includes(kind)) throw bad(400,'ชนิดเอกสารไม่ถูกต้อง')
    const column=kind==='identity'?'identity_document_key':'authorization_document_key'
    const found=await one<Record<string,string>>(`SELECT ${column} FROM resident_profiles WHERE user_id=$1 AND org_id=$2`,[user.id,orgId])
    const key=found?.[column]
    if (!key) throw bad(404,'ไม่พบเอกสาร')
    const type=key.endsWith('.pdf')?'application/pdf':key.endsWith('.png')?'image/png':'image/jpeg'
    const file=await getPrivate(key)
    await rows('INSERT INTO audit_events(org_id,actor_id,target_id,method,route,status) VALUES($1,$2,$3,$4,$5,$6)',[orgId,owner.id,user.id,'GET','/api/residents/:id/documents/:kind',200])
    reply.header('Content-Type',type).header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').send(file)
  })
  app.get('/api/residents/:id/registry-history', async req => {
    const orgId=admin(await actor(req)),user=await subject(req,orgId)
    const [inspections,visitors,complaints,maintenance]=await Promise.all([
      rows('SELECT i.*,u.name recorded_by_name FROM resident_inspections i LEFT JOIN users u ON u.id=i.recorded_by WHERE i.org_id=$1 AND i.user_id=$2 ORDER BY i.inspected_at DESC',[orgId,user.id]),
      rows('SELECT v.*,u.name recorded_by_name FROM visitor_logs v LEFT JOIN users u ON u.id=v.recorded_by WHERE v.org_id=$1 AND v.user_id=$2 ORDER BY v.entered_at DESC',[orgId,user.id]),
      rows('SELECT c.*,u.name recorded_by_name FROM resident_complaints c LEFT JOIN users u ON u.id=c.recorded_by WHERE c.org_id=$1 AND c.user_id=$2 ORDER BY c.created_at DESC',[orgId,user.id]),
      rows('SELECT id,subject,detail,status,created_at FROM maintenance WHERE org_id=$1 AND user_id=$2 ORDER BY created_at DESC',[orgId,user.id]),
    ])
    return {inspections,visitors,complaints,maintenance}
  })
  app.post('/api/residents/:id/inspections', async req => {
    const owner=await actor(req),orgId=admin(owner),user=await subject(req,orgId),d=body(req)
    const kind=text(d.kind,'ประเภท',20),at=z.string().datetime({offset:true}).parse(d.inspected_at)
    if (!['move_in','move_out','other'].includes(kind)) throw bad(400,'ประเภทไม่ถูกต้อง')
    return one('INSERT INTO resident_inspections(org_id,user_id,kind,inspected_at,condition_note,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [orgId,user.id,kind,at,text(d.condition_note,'บันทึกสภาพห้อง',2000),owner.id])
  })
  app.post('/api/residents/:id/visitors', async req => {
    const owner=await actor(req),orgId=admin(owner),user=await subject(req,orgId),d=body(req)
    const at=z.string().datetime({offset:true}).parse(d.entered_at),left=d.left_at?z.string().datetime({offset:true}).parse(d.left_at):null
    if(left&&left<at)throw bad(400,'เวลาออกก่อนเวลาเข้า')
    return one('INSERT INTO visitor_logs(org_id,user_id,visitor_name,purpose,entered_at,left_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [orgId,user.id,text(d.visitor_name,'ชื่อผู้มาติดต่อ',120),typeof d.purpose==='string'?d.purpose.slice(0,300):'',at,left,owner.id])
  })
  app.post('/api/residents/:id/complaints', async req => {
    const owner=await actor(req),orgId=admin(owner),user=await subject(req,orgId),d=body(req)
    return one('INSERT INTO resident_complaints(org_id,user_id,subject,detail,recorded_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [orgId,user.id,text(d.subject,'หัวข้อ',120),text(d.detail,'รายละเอียด',2000),owner.id])
  })
  app.get('/api/audit', async req => {
    const orgId=admin(await actor(req))
    return rows('SELECT a.id,a.method,a.route,a.status,a.created_at,u.name actor_name,t.name target_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users t ON t.id=a.target_id WHERE a.org_id=$1 ORDER BY a.created_at DESC LIMIT 200',[orgId])
  })
}
