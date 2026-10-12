import type { FastifyInstance } from 'fastify'
import type { PoolClient } from 'pg'
import { randomBytes } from 'node:crypto'
import { actor, admin, bad } from './auth.js'
import { passwordHash, transaction } from './db.js'
import { body, id, text, optional, amount, whole } from './http.js'
import { config } from './config.js'
import { decryptPersonal } from './pii.js'

type Target='units'|'residents'|'contracts'|'invoices'
type Unit={id:string;property:string;building:string;number:string;status:string;rent:string;deposit:string;resident_id:string|null;resident_name:string|null;contract_id:string|null}
type Plan={row:number;unit?:Unit;values:Record<string,string|number>}
const fields:Record<Target,string[]>={
  units:['property','building','number','floor','rent','deposit','area','room_type','owner_name','owner_phone'],
  residents:['property','building','number','name','username'],
  contracts:['property','building','number','start_date','end_date','rent','deposit','sign_mode'],
  invoices:['property','building','number','period','due','rent','water','electric','other'],
}
function validDate(value:string):boolean {return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value}
function calendarDate(value:string):string {return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)?value.slice(0,10):value}
function billingPeriod(value:string):string {return /^\d{4}-\d{2}-01T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)?value.slice(0,7):value}
function mapped(input:unknown,headers:string[],target:Target):Record<string,string> {
  if(!input||typeof input!=='object'||Array.isArray(input))throw bad(400,'กรุณาเลือกคอลัมน์')
  const source=input as Record<string,unknown>,result:Record<string,string>={}
  for(const field of fields[target]){
    const header=source[field]
    if(header===undefined||header==='')continue
    if(typeof header!=='string'||!headers.includes(header))throw bad(400,`คอลัมน์ ${field} ไม่อยู่ในชุดข้อมูล`)
    result[field]=header
  }
  if(!result.number)throw bad(400,'กรุณาเลือกคอลัมน์เลขห้อง')
  if(target==='residents'&&!result.name)throw bad(400,'กรุณาเลือกคอลัมน์ชื่อผู้พัก')
  if(target==='contracts'&&(!result.start_date||!result.end_date))throw bad(400,'กรุณาเลือกคอลัมน์วันเริ่มและสิ้นสุดสัญญา')
  if(target==='invoices'&&(!result.period||!result.due))throw bad(400,'กรุณาเลือกคอลัมน์งวดบิลและวันครบกำหนด')
  return result
}
async function prepare(client:PoolClient,orgId:string,datasetId:string,target:Target,mappingInput:unknown){
  const dataset=(await client.query<{headers:string[]}>('SELECT headers FROM customer_datasets WHERE id=$1 AND org_id=$2 FOR SHARE',[datasetId,orgId])).rows[0]
  if(!dataset)throw bad(404,'ไม่พบชุดข้อมูล')
  const mapping=mapped(mappingInput,dataset.headers,target),headers=dataset.headers
  const raw=(await client.query<{row_number:number;ciphertext:string}>('SELECT row_number,ciphertext FROM customer_dataset_rows WHERE dataset_id=$1 ORDER BY row_number',[datasetId])).rows
  const units=(await client.query<Unit>(`SELECT u.id,p.name property,u.building,u.number,u.status,u.rent,u.deposit,r.id resident_id,r.name resident_name,c.id contract_id
    FROM units u JOIN properties p ON p.id=u.property_id LEFT JOIN users r ON r.unit_id=u.id AND r.role='resident'
    LEFT JOIN contracts c ON c.unit_id=u.id AND c.status='active' WHERE u.org_id=$1`,[orgId])).rows
  const usernames=new Set((await client.query<{username:string}>('SELECT username FROM users WHERE org_id=$1',[orgId])).rows.map(x=>x.username))
  const invoiceKeys=new Set((await client.query<{unit_id:string;period:string}>('SELECT unit_id,period FROM invoices WHERE org_id=$1',[orgId])).rows.map(x=>`${x.unit_id}|${x.period}`))
  const seen=new Set<string>(),plans:Plan[]=[],errors:{row:number;message:string}[]=[]
  let skipped=0
  for(const record of raw){
    try{
      const cells=JSON.parse(decryptPersonal(record.ciphertext,config.PII_ENCRYPTION_KEY)) as string[]
      const get=(field:string)=>mapping[field]?String(cells[headers.indexOf(mapping[field])]||'').trim():''
      const number=text(get('number'),'เลขห้อง',20),property=get('property'),building=get('building')
      if(target==='units'){
        const project=text(property||'โครงการหลัก','โครงการ',100),block=text(building||'หลัก','อาคาร',30),key=`${project}|${block}|${number}`
        if(seen.has(key)||units.some(u=>u.property===project&&u.building===block&&u.number===number)){skipped++;continue}
        seen.add(key)
        plans.push({row:record.row_number,values:{property:project,building:block,number,floor:whole(get('floor')||0,'ชั้น'),rent:amount(get('rent')||0,'ค่าเช่า'),deposit:amount(get('deposit')||0,'เงินประกัน'),area:amount(get('area')||0,'พื้นที่'),room_type:optional(get('room_type'),60)||'Standard',owner_name:optional(get('owner_name'),120),owner_phone:optional(get('owner_phone'),30)}})
        continue
      }
      const matches=units.filter(u=>u.number===number&&(!property||u.property===property)&&(!building||u.building===building))
      if(matches.length!==1)throw bad(400,matches.length?'เลขห้องซ้ำหลายอาคาร/โครงการ กรุณาจับคู่คอลัมน์เพิ่ม':'ไม่พบห้อง กรุณานำเข้าห้องก่อน')
      const unit=matches[0]!,key=target==='invoices'?`${unit.id}|${get('period')}`:unit.id
      if(seen.has(key)){skipped++;continue}
      seen.add(key)
      if(target==='residents'){
        const name=text(get('name'),'ชื่อผู้พัก',100),username=get('username')
        if(unit.resident_id){if(unit.resident_name===name){skipped++;continue}throw bad(409,'ห้องมีผู้พักคนอื่นอยู่แล้ว')}
        if(unit.status!=='available')throw bad(409,'ห้องไม่ว่าง')
        if(username){text(username,'ชื่อผู้ใช้',40);if(usernames.has(username))throw bad(409,'ชื่อผู้ใช้ซ้ำ');usernames.add(username)}
        plans.push({row:record.row_number,unit,values:{name,username}})
      }else if(target==='contracts'){
        if(!unit.resident_id)throw bad(409,'ยังไม่มีบัญชีผู้พักในห้อง')
        if(unit.contract_id){skipped++;continue}
        const start=text(calendarDate(get('start_date')),'วันเริ่มสัญญา',10),end=text(calendarDate(get('end_date')),'วันสิ้นสุดสัญญา',10)
        if(!validDate(start)||!validDate(end)||start>=end)throw bad(400,'วันที่สัญญาไม่ถูกต้อง')
        const mode=get('sign_mode')||'paper'
        if(!['paper','electronic'].includes(mode))throw bad(400,'รูปแบบสัญญาต้องเป็น paper หรือ electronic')
        plans.push({row:record.row_number,unit,values:{start_date:start,end_date:end,rent:amount(get('rent')||unit.rent,'ค่าเช่า'),deposit:amount(get('deposit')||unit.deposit,'เงินประกัน'),sign_mode:mode}})
      }else{
        const period=text(billingPeriod(get('period')),'งวดบิล',7),due=text(calendarDate(get('due')),'วันครบกำหนด',10)
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||!validDate(due))throw bad(400,'งวดบิลหรือวันครบกำหนดไม่ถูกต้อง')
        const invoiceKey=`${unit.id}|${period}`
        if(invoiceKeys.has(invoiceKey)){skipped++;continue}
        plans.push({row:record.row_number,unit,values:{period,due,rent:amount(get('rent')||unit.rent,'ค่าเช่า'),water:amount(get('water')||0,'ค่าน้ำ'),electric:amount(get('electric')||0,'ค่าไฟ'),other:amount(get('other')||0,'อื่นๆ')}})
      }
    }catch(error){errors.push({row:record.row_number,message:error instanceof Error?error.message:'ข้อมูลไม่ถูกต้อง'})}
  }
  return {plans,skipped,errors}
}

export function registerMappingRoutes(app:FastifyInstance):void {
  for(const mode of ['preview','confirm'] as const)app.post(`/api/datasets/:id/mapping/${mode}`,async req=>{
    const owner=await actor(req),orgId=admin(owner),datasetId=id(req),input=body(req),target=input.target as Target
    if(!Object.hasOwn(fields,target))throw bad(400,'ประเภทข้อมูลไม่ถูกต้อง')
    return transaction(async client=>{
      const prepared=await prepare(client,orgId,datasetId,target,input.mapping)
      const summary={created:prepared.plans.length,skipped:prepared.skipped,errors:prepared.errors.slice(0,100),error_count:prepared.errors.length}
      if(mode==='preview')return summary
      if(prepared.errors.length)throw bad(409,`พบข้อมูลผิด ${prepared.errors.length} แถว กรุณาตรวจตัวอย่างอีกครั้ง`)
      const credentials:{room:string;name:string;username:string;password:string}[]=[]
      const projectIds=new Map<string,string>()
      for(const plan of prepared.plans){
        const v=plan.values
        if(target==='units'){
          const project=String(v.property)
          if(!projectIds.has(project)){
            const result=await client.query<{id:string}>('INSERT INTO properties(org_id,name) VALUES($1,$2) ON CONFLICT(org_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[orgId,project])
            projectIds.set(project,result.rows[0]!.id)
          }
          await client.query(`INSERT INTO units(org_id,property_id,building,number,floor,rent,deposit,area,room_type,owner_name,owner_phone)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[orgId,projectIds.get(project),v.building,v.number,v.floor,v.rent,v.deposit,v.area,v.room_type,v.owner_name,v.owner_phone])
        }else if(target==='residents'){
          const unit=plan.unit!,password=randomBytes(18).toString('base64url'),username=String(v.username||`import-${randomBytes(8).toString('hex')}`)
          const claimed=await client.query("UPDATE units SET status='occupied',invite_hash=NULL,invite_expires_at=NULL WHERE id=$1 AND org_id=$2 AND status='available' RETURNING id",[unit.id,orgId])
          if(!claimed.rowCount)throw bad(409,'สถานะห้องเปลี่ยนไป กรุณาตรวจตัวอย่างอีกครั้ง')
          await client.query('INSERT INTO users(org_id,username,password_hash,name,role,unit_id) VALUES($1,$2,$3,$4,$5,$6)',[orgId,username,await passwordHash(password),v.name,'resident',unit.id])
          credentials.push({room:`${unit.building} ${unit.number}`,name:String(v.name),username,password})
        }else if(target==='contracts'){
          await client.query(`INSERT INTO contracts(org_id,unit_id,user_id,start_date,end_date,rent,deposit,sign_mode)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[orgId,plan.unit!.id,plan.unit!.resident_id,v.start_date,v.end_date,v.rent,v.deposit,v.sign_mode])
        }else{
          await client.query(`INSERT INTO invoices(org_id,unit_id,period,due,rent,water,electric,other)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[orgId,plan.unit!.id,v.period,v.due,v.rent,v.water,v.electric,v.other])
        }
      }
      return {...summary,credentials}
    })
  })
}
