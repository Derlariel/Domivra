import type { FastifyInstance } from 'fastify'
import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import { actor, admin, bad } from './auth.js'
import { rows, transaction } from './db.js'
import { body, text, whole, amount, optional } from './http.js'

const fields = ['property','building','number','floor','rent','deposit','area','room_type','water_meter','electric_meter','owner_name','owner_phone'] as const
type ImportRow = Record<(typeof fields)[number], string>

export function registerImportRoutes(app: FastifyInstance): void {
  app.get('/api/imports', async req => {
    const orgId=admin(await actor(req))
    return rows('SELECT id,filename,imported,skipped,created_at FROM imports WHERE org_id=$1 ORDER BY created_at DESC LIMIT 30',[orgId])
  })
  app.post('/api/import/parse', async req => {
    await admin(await actor(req))
    const d=body(req), filename=text(d.filename,'ชื่อไฟล์',160)
    if (!/\.(csv|xlsx)$/i.test(filename)) throw bad(400,'รองรับไฟล์ .csv หรือ .xlsx')
    const encoded=String(d.file||'').match(/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/)
    if (!encoded) throw bad(400,'ไฟล์ไม่ถูกต้อง')
    const bytes=Buffer.from(encoded[1]!, 'base64')
    if (!bytes.length||bytes.length>4_000_000) throw bad(413,'ไฟล์ต้องไม่เกิน 4 MB')
    const workbook=new ExcelJS.Workbook()
    try {
      if (/\.csv$/i.test(filename)) await workbook.csv.read(Readable.from(bytes))
      else await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    } catch { throw bad(400,'อ่านไฟล์ไม่ได้ กรุณาตรวจรูปแบบไฟล์') }
    const sheet=workbook.worksheets[0]
    if (!sheet) throw bad(400,'ไฟล์ไม่มีข้อมูล')
    const headers=Array.from({length:sheet.columnCount},(_,i)=>String(sheet.getRow(1).getCell(i+1).text).trim().toLowerCase())
    if (fields.slice(0,7).some(field=>!headers.includes(field))) throw bad(400,'หัวตารางต้องมี property, building, number, floor, rent, deposit, area')
    const parsed:ImportRow[]=[]
    sheet.eachRow((row,index)=>{
      if (index===1) return
      if (parsed.length>=5000) throw bad(400,'รองรับไม่เกิน 5,000 แถว')
      const values=Object.fromEntries(fields.map(field=>[field,headers.includes(field)?String(row.getCell(headers.indexOf(field)+1).text||'').trim():''])) as ImportRow
      if (fields.some(field=>values[field])) parsed.push(values)
    })
    if (!parsed.length) throw bad(400,'ไฟล์ไม่มีข้อมูล')
    return {filename,rows:parsed}
  })
  app.post('/api/import/confirm', async req => {
    const orgId=admin(await actor(req)),d=body(req),filename=text(d.filename,'ชื่อไฟล์',160)
    if (!Array.isArray(d.rows)||!d.rows.length||d.rows.length>5000) throw bad(400,'จำนวนแถวไม่ถูกต้อง')
    const seen=new Set<string>()
    const parsed=d.rows.map((raw:unknown,index:number)=>{
      if (!raw||typeof raw!=='object'||Array.isArray(raw)) throw bad(400,`แถว ${index+2} ไม่ถูกต้อง`)
      const value=raw as Record<string,unknown>
      const property=text(value.property,'โครงการ',100), building=text(value.building,'อาคาร',30), number=text(value.number,'เลขห้อง',20)
      const key=JSON.stringify([property,building,number])
      if (seen.has(key)) throw bad(400,`เลขห้องซ้ำในไฟล์ แถว ${index+2}`)
      seen.add(key)
      return {property,building,number,floor:whole(value.floor,'ชั้น'),rent:amount(value.rent,'ค่าเช่า'),deposit:amount(value.deposit,'เงินประกัน'),area:amount(value.area,'พื้นที่'),roomType:optional(value.room_type,60)||'Standard',waterMeter:optional(value.water_meter,60),electricMeter:optional(value.electric_meter,60),ownerName:optional(value.owner_name,120),ownerPhone:optional(value.owner_phone,30)}
    })
    return transaction(async client=>{
      let imported=0,skipped=0
      for (const item of parsed) {
        const property=await client.query<{id:string}>('INSERT INTO properties(org_id,name) VALUES($1,$2) ON CONFLICT (org_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[orgId,item.property])
        const result=await client.query(`INSERT INTO units(org_id,property_id,building,number,floor,rent,deposit,area,room_type,water_meter,electric_meter,owner_name,owner_phone)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (org_id,property_id,building,number) DO NOTHING RETURNING id`,[orgId,property.rows[0]!.id,item.building,item.number,item.floor,item.rent,item.deposit,item.area,item.roomType,item.waterMeter,item.electricMeter,item.ownerName,item.ownerPhone])
        if (result.rowCount) imported++; else skipped++
      }
      const record=await client.query('INSERT INTO imports(org_id,filename,imported,skipped) VALUES($1,$2,$3,$4) RETURNING id',[orgId,filename,imported,skipped])
      return {id:record.rows[0]?.id,imported,skipped}
    })
  })
}
