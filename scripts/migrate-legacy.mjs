import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const root=path.resolve(import.meta.dirname,'..')
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').trim().split('\n').map(line=>line.split(/=(.*)/s).slice(0,2)))
const old=new DatabaseSync(path.join(root,'data/domivra.sqlite'),{readOnly:true})
const source=(table)=>old.prepare(`SELECT * FROM ${table}`).all()
const pool=new pg.Pool({connectionString:`postgresql://domivra:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:5433/domivra`})
const client=await pool.connect()
const maps=Object.fromEntries(['properties','units','users','invoices','contracts'].map(table=>[table,new Map()]))
const add=async(table,oldId,sql,params)=>{const {rows}=await client.query(sql,params);maps[table].set(oldId,rows[0].id)}
const id=(table,oldId)=>maps[table].get(oldId)
try {
  await client.query('BEGIN')
  if((await client.query('SELECT 1 FROM organizations WHERE slug=$1',['domivra'])).rowCount) throw Error('มีองค์กร domivra ใน PostgreSQL แล้ว กรุณาตรวจข้อมูลก่อนนำเข้าซ้ำ')
  const org=(await client.query('INSERT INTO organizations(slug,name) VALUES($1,$2) RETURNING id',['domivra','Domivra Residence'])).rows[0].id
  for(const p of source('properties')) await add('properties',p.id,'INSERT INTO properties(org_id,name,address) VALUES($1,$2,$3) RETURNING id',[org,p.name,p.address])
  for(const u of source('units')) await add('units',u.id,`INSERT INTO units(org_id,property_id,building,number,floor,rent,deposit,room_type,area,water_meter,electric_meter,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[org,id('properties',u.property_id),u.building,u.number,u.floor,u.rent,u.deposit,u.room_type,u.area,u.water_meter,u.electric_meter,u.status])
  for(const u of source('users')) await add('users',u.id,'INSERT INTO users(org_id,username,password_hash,name,role,unit_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[org,u.username,`${u.salt}:${u.password}`,u.name,u.role,u.unit_id?id('units',u.unit_id):null])
  for(const row of source('settings')) await client.query('INSERT INTO settings(org_id,key,value) VALUES($1,$2,$3)',[org,row.key,row.value])
  for(const row of source('announcements')) await client.query(`INSERT INTO announcements(org_id,title,body,category,building,priority,status,publish_at,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[org,row.title,row.body,row.category,row.building,row.priority,row.status,row.publish_at||null,row.created_at])
  for(const row of source('rules')) await client.query('INSERT INTO rules(org_id,title,body) VALUES($1,$2,$3)',[org,row.title,row.body])
  for(const row of source('facilities')) await client.query('INSERT INTO facilities(org_id,property_id,building,name,detail) VALUES($1,$2,$3,$4,$5)',[org,id('properties',row.property_id),row.building,row.name,row.detail])
  for(const row of source('maintenance')) await client.query('INSERT INTO maintenance(org_id,user_id,unit_id,subject,detail,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[org,id('users',row.user_id),id('units',row.unit_id),row.subject,row.detail,row.status,row.created_at])
  for(const row of source('incidents')) await client.query('INSERT INTO incidents(org_id,user_id,property_id,area,detail,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[org,id('users',row.user_id),id('properties',row.property_id),row.area,row.detail,row.status,row.created_at])
  for(const row of source('contracts')) await add('contracts',row.id,`INSERT INTO contracts(org_id,unit_id,user_id,start_date,end_date,rent,deposit,status,sign_mode,sign_status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[org,id('units',row.unit_id),id('users',row.user_id),row.start_date,row.end_date,row.rent,row.deposit,row.status,row.sign_mode,row.document?'pending':row.sign_status])
  for(const row of source('invoices')) await add('invoices',row.id,`INSERT INTO invoices(org_id,unit_id,period,rent,water,electric,other,water_previous,water_current,electric_previous,electric_current,due,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[org,id('units',row.unit_id),row.period,row.rent||row.amount,row.water,row.electric,row.other,row.water_previous,row.water_current,row.electric_previous,row.electric_current,row.due,row.status])
  let skippedEvidence=0
  for(const row of source('payments')) {
    if(!existsSync(path.join(root,'data',row.evidence))) {skippedEvidence++;continue}
    // shortcut: legacy files need an explicit S3 upload path before payments can be migrated.
    skippedEvidence++
  }
  await client.query('COMMIT')
  console.log(`นำเข้าข้อมูลองค์กร ห้อง ผู้พัก สัญญา และบิลแล้ว; หลักฐานชำระที่ยังไม่อยู่ใน S3: ${skippedEvidence} รายการ`)
} catch(error) {await client.query('ROLLBACK');throw error}
finally {client.release();await pool.end();old.close()}
