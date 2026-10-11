import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { actor, admin, bad, org, resident, tokenHash } from './auth.js'
import { one, rows, transaction, passwordHash } from './db.js'
import { body, id, optional, text, amount, whole } from './http.js'

const incidentEvents = new EventEmitter()
incidentEvents.setMaxListeners(0)
export function publishIncident(orgId: string): void { incidentEvents.emit(orgId) }

export function registerCoreRoutes(app: FastifyInstance): void {
  app.get('/api/organizations', async req => { await actor(req,'platform'); return rows('SELECT id,slug,name,status FROM organizations ORDER BY created_at') })
  app.post('/api/organizations', async req => {
    await actor(req,'platform'); const d=body(req), slug=text(d.slug,'รหัสองค์กร',40).toLowerCase(), name=text(d.name,'ชื่อองค์กร',120), username=text(d.username,'ชื่อผู้ใช้',60), adminName=text(d.admin_name,'ชื่อผู้ดูแล',120)
    if (!/^[a-z0-9-]{3,40}$/.test(slug) || slug==='platform') throw bad(400,'รหัสองค์กรไม่ถูกต้อง')
    const password=randomBytes(18).toString('base64url')
    const created=await transaction(async client => {
      const organization=await client.query<{ id: string }>('INSERT INTO organizations(slug,name) VALUES($1,$2) RETURNING id',[slug,name])
      const orgId=organization.rows[0]!.id
      await client.query('INSERT INTO users(org_id,username,password_hash,name,role) VALUES($1,$2,$3,$4,$5)',[orgId,username,await passwordHash(password),adminName,'admin'])
      return orgId
    })
    return { id: created, slug, username, password }
  })
  app.patch('/api/organizations/:id', async req => {
    await actor(req,'platform'); const d=body(req), status=text(d.status,'สถานะ')
    if (!['active','suspended'].includes(status)) throw bad(400,'สถานะไม่ถูกต้อง')
    const result=await one('UPDATE organizations SET status=$1 WHERE id=$2 RETURNING id',[status,id(req)])
    if (!result) throw bad(404,'ไม่พบองค์กร')
    return { ok:true }
  })
  app.get('/api/settings', async req => {
    const user=await actor(req), values=await rows<{key:string;value:string}>('SELECT key,value FROM settings WHERE org_id=$1',[org(user)])
    const result=Object.fromEntries(values.map(x=>[x.key,x.value]))
    return user.role==='admin' ? result : Object.fromEntries(['org_name','office_phone','security_phone','emergency_phone','bank_name','bank_account','bank_number'].map(k=>[k,result[k]||'']))
  })
  app.patch('/api/settings', async req => {
    const orgId=admin(await actor(req)),d=body(req)
    const keys=['org_name','tax_id','org_address','office_email','office_phone','security_phone','emergency_phone','bank_name','bank_account','bank_number','billing_day']
    for(const key of keys) if (key in d) await rows('INSERT INTO settings(org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO UPDATE SET value=EXCLUDED.value',[orgId,key,optional(d[key],160)])
    return {ok:true}
  })
  app.get('/api/overview', async req => {
    const orgId=admin(await actor(req))
    const [units,revenue,outstanding,pending,monthly,recent]=await Promise.all([
      one('SELECT count(*)::int total,count(*) FILTER (WHERE status=$2)::int occupied,count(*) FILTER (WHERE status=$3)::int maintenance FROM units WHERE org_id=$1',[orgId,'occupied','maintenance']),
      one('SELECT coalesce(sum(amount),0) total FROM payments WHERE org_id=$1 AND status=$2',[orgId,'verified']),
      one(`SELECT coalesce(sum(i.amount-coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='verified'),0)),0) total FROM invoices i WHERE i.org_id=$1 AND i.status='published'`,[orgId]),
      one('SELECT count(*)::int total FROM payments WHERE org_id=$1 AND status=$2',[orgId,'pending']),
      rows('SELECT i.period,sum(p.amount) total FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.org_id=$1 AND p.status=$2 GROUP BY i.period ORDER BY i.period DESC LIMIT 6',[orgId,'verified']),
      rows('SELECT p.id,p.amount,p.status,p.created_at,u.number,us.name FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN units u ON u.id=i.unit_id JOIN users us ON us.id=p.user_id WHERE p.org_id=$1 ORDER BY p.created_at DESC LIMIT 5',[orgId])
    ])
    return {units,revenue,outstanding,pending,monthly:monthly.reverse(),recent}
  })
  app.get('/api/properties', async req => { const orgId=org(await actor(req)); return rows('SELECT * FROM properties WHERE org_id=$1 ORDER BY name',[orgId]) })
  app.post('/api/properties', async req => { const orgId=admin(await actor(req)),d=body(req);return one('INSERT INTO properties(org_id,name,address) VALUES($1,$2,$3) RETURNING id',[orgId,text(d.name,'ชื่อโครงการ',100),optional(d.address)]) })
  app.patch('/api/properties/:id', async req => {const orgId=admin(await actor(req)),d=body(req);const found=await one('UPDATE properties SET name=$1,address=$2 WHERE id=$3 AND org_id=$4 RETURNING id',[text(d.name,'ชื่อโครงการ',100),optional(d.address),id(req),orgId]);if(!found)throw bad(404,'ไม่พบโครงการ');return {ok:true}})
  app.get('/api/facilities', async req => {const user=await actor(req);return user.role==='admin'?rows('SELECT * FROM facilities WHERE org_id=$1 ORDER BY name',[org(user)]):[]})
  app.post('/api/facilities', async req => {const orgId=admin(await actor(req)),d=body(req),propertyId=String(d.property_id);if(!await one('SELECT id FROM properties WHERE id=$1 AND org_id=$2',[propertyId,orgId]))throw bad(404,'ไม่พบโครงการ');return one('INSERT INTO facilities(org_id,property_id,building,name,detail) VALUES($1,$2,$3,$4,$5) RETURNING id',[orgId,propertyId,optional(d.building,30),text(d.name,'ชื่อพื้นที่',100),optional(d.detail)])})
  app.get('/api/units', async req => {const user=await actor(req),orgId=org(user);return user.role==='admin'?rows(`SELECT u.*,p.name property,us.name resident FROM units u JOIN properties p ON p.id=u.property_id LEFT JOIN users us ON us.unit_id=u.id AND us.role='resident' WHERE u.org_id=$1 ORDER BY p.name,u.building,u.number`,[orgId]):rows('SELECT u.id,u.number,u.building,u.floor,p.name property FROM units u JOIN properties p ON p.id=u.property_id WHERE u.id=$1 AND u.org_id=$2',[user.unit_id,orgId])})
  app.post('/api/units', async req => {
    const orgId=admin(await actor(req)),d=body(req),propertyId=String(d.property_id)
    if(!await one('SELECT id FROM properties WHERE id=$1 AND org_id=$2',[propertyId,orgId]))throw bad(404,'ไม่พบโครงการ')
    return one(`INSERT INTO units(org_id,property_id,building,number,floor,rent,deposit,room_type,area,water_meter,electric_meter)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[orgId,propertyId,text(d.building,'อาคาร',30),text(d.number,'เลขห้อง',20),whole(d.floor,'ชั้น'),amount(d.rent,'ค่าเช่า'),amount(d.deposit??0,'เงินประกัน'),optional(d.room_type,60)||'Standard',amount(d.area??0,'พื้นที่'),optional(d.water_meter,60),optional(d.electric_meter,60)])
  })
  app.patch('/api/units/:id', async req => {const orgId=admin(await actor(req)),d=body(req);if(!['available','occupied','maintenance'].includes(String(d.status)))throw bad(400,'สถานะไม่ถูกต้อง');const unitId=id(req),hasResident=!!await one('SELECT id FROM users WHERE unit_id=$1 AND role=$2',[unitId,'resident']);if((d.status==='occupied')!==hasResident)throw bad(409,'สถานะไม่ตรงกับผู้พัก');const found=await one(`UPDATE units SET rent=$1,deposit=$2,room_type=$3,area=$4,water_meter=$5,electric_meter=$6,status=$7 WHERE id=$8 AND org_id=$9 RETURNING id`,[amount(d.rent,'ค่าเช่า'),amount(d.deposit??0,'เงินประกัน'),optional(d.room_type,60)||'Standard',amount(d.area??0,'พื้นที่'),optional(d.water_meter,60),optional(d.electric_meter,60),d.status,unitId,orgId]);if(!found)throw bad(404,'ไม่พบห้อง');return {ok:true}})
  app.post('/api/units/:id/invite', async req => {const orgId=admin(await actor(req)),unitId=id(req),invite=randomBytes(18).toString('base64url');const found=await one("UPDATE units SET invite_hash=$1,invite_expires_at=now()+interval '7 days' WHERE id=$2 AND org_id=$3 AND status='available' RETURNING invite_expires_at",[tokenHash(invite),unitId,orgId]);if(!found)throw bad(409,'ห้องนี้ไม่ว่าง');return {invite,expires:found.invite_expires_at}})
  app.get('/api/residents', async req => {const orgId=admin(await actor(req));return rows(`SELECT us.id,us.username,us.name,us.unit_id,u.number FROM users us LEFT JOIN units u ON u.id=us.unit_id WHERE us.org_id=$1 AND us.role='resident' ORDER BY us.name`,[orgId])})
  app.post('/api/residents', async req => {const orgId=admin(await actor(req)),d=body(req),unitId=String(d.unit_id),password=randomBytes(18).toString('base64url');const result=await transaction(async client=>{const claimed=await client.query("UPDATE units SET status='occupied',invite_hash=NULL WHERE id=$1 AND org_id=$2 AND status='available' RETURNING id",[unitId,orgId]);if(!claimed.rowCount)throw bad(409,'ห้องนี้ไม่ว่าง');const made=await client.query<{id:string}>('INSERT INTO users(org_id,username,password_hash,name,role,unit_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[orgId,text(d.username,'ชื่อผู้ใช้',40),await passwordHash(password),text(d.name,'ชื่อผู้พัก',100),'resident',unitId]);return made.rows[0]!.id});return {id:result,username:d.username,password}})
  app.patch('/api/residents/:id', async req => {const orgId=admin(await actor(req)),d=body(req);const found=await one('UPDATE users SET name=$1 WHERE id=$2 AND org_id=$3 AND role=$4 RETURNING id',[text(d.name,'ชื่อผู้พัก',100),id(req),orgId,'resident']);if(!found)throw bad(404,'ไม่พบผู้พัก');return {ok:true}})
  app.get('/api/events', async (req,reply) => {
    const orgId=org(await actor(req)); reply.hijack()
    reply.raw.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'})
    reply.raw.write(': connected\n\n')
    const send=()=>reply.raw.write('event: incident\ndata: {}\n\n')
    incidentEvents.on(orgId,send)
    const keepalive=setInterval(()=>reply.raw.write(': ping\n\n'),25000)
    reply.raw.on('close',()=>{clearInterval(keepalive);incidentEvents.off(orgId,send)})
  })
  app.get('/api/incidents', async req => {const user=await actor(req),orgId=org(user);return user.role==='admin'?rows('SELECT i.*,p.name property,u.name reporter FROM incidents i JOIN properties p ON p.id=i.property_id JOIN users u ON u.id=i.user_id WHERE i.org_id=$1 ORDER BY i.created_at DESC',[orgId]):rows('SELECT i.*,p.name property FROM incidents i JOIN properties p ON p.id=i.property_id WHERE i.org_id=$1 AND i.user_id=$2 ORDER BY i.created_at DESC',[orgId,user.id])})
  app.post('/api/incidents', async req => {const user=await actor(req),orgId=resident(user),d=body(req),propertyId=String(d.property_id);if(!await one('SELECT id FROM properties WHERE id=$1 AND org_id=$2',[propertyId,orgId]))throw bad(404,'ไม่พบโครงการ');const result=await one('INSERT INTO incidents(org_id,user_id,property_id,area,detail) VALUES($1,$2,$3,$4,$5) RETURNING id',[orgId,user.id,propertyId,text(d.area,'จุดที่ชำรุด',120),text(d.detail,'รายละเอียด',1000)]);publishIncident(orgId);return result})
  app.patch('/api/incidents/:id', async req => {const orgId=admin(await actor(req)),d=body(req);if(!['open','in_progress','done'].includes(String(d.status)))throw bad(400,'สถานะไม่ถูกต้อง');const found=await one('UPDATE incidents SET status=$1 WHERE id=$2 AND org_id=$3 RETURNING id',[d.status,id(req),orgId]);if(!found)throw bad(404,'ไม่พบรายงาน');publishIncident(orgId);return {ok:true}})
}
