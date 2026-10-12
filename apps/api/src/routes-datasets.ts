import type { FastifyInstance } from 'fastify'
import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import { actor, admin, bad } from './auth.js'
import { one, rows, transaction } from './db.js'
import { body, id, text } from './http.js'
import { config } from './config.js'
import { decryptPersonal, encryptPersonal } from './pii.js'

type Sheet = {name:string;headers:string[];rows:string[][]}
function validSheet(value:unknown): Sheet {
  if (!value || typeof value!=='object') throw bad(400,'ข้อมูลตารางไม่ถูกต้อง')
  const sheet=value as Sheet
  if (!Array.isArray(sheet.headers)||!sheet.headers.length||sheet.headers.length>200||
      sheet.headers.some(h=>typeof h!=='string'||!h.trim()||h.length>120)||new Set(sheet.headers).size!==sheet.headers.length)
    throw bad(400,'หัวตารางต้องไม่ว่างหรือซ้ำกัน และมีได้ไม่เกิน 200 คอลัมน์')
  if (!Array.isArray(sheet.rows)||!sheet.rows.length||sheet.rows.some(row=>!Array.isArray(row)||row.length!==sheet.headers.length||row.some(cell=>typeof cell!=='string')))
    throw bad(400,'ข้อมูลแต่ละแถวไม่ตรงกับหัวตาราง')
  return {name:text(sheet.name,'ชื่อแผ่นงาน',120),headers:sheet.headers,rows:sheet.rows}
}

export function registerDatasetRoutes(app:FastifyInstance):void {
  app.get('/api/datasets',async req=>{
    const orgId=admin(await actor(req))
    return rows('SELECT id,name,filename,row_count,created_at FROM customer_datasets WHERE org_id=$1 ORDER BY created_at DESC',[orgId])
  })
  app.post('/api/datasets/parse',async req=>{
    await admin(await actor(req))
    const input=body(req),filename=text(input.filename,'ชื่อไฟล์',160)
    if(!/\.(csv|xlsx)$/i.test(filename))throw bad(400,'รองรับไฟล์ .csv หรือ .xlsx')
    const encoded=typeof input.file==='string'?input.file.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/):null
    if(!encoded)throw bad(400,'ไฟล์ไม่ถูกต้อง')
    const bytes=Buffer.from(encoded[1]!, 'base64')
    if(!bytes.length||bytes.length>4_000_000)throw bad(413,'ไฟล์ต้องไม่เกิน 4 MB')
    const workbook=new ExcelJS.Workbook()
    try {
      if(/\.csv$/i.test(filename))await workbook.csv.read(Readable.from(bytes))
      else await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    }catch{throw bad(400,'อ่านไฟล์ไม่ได้ กรุณาตรวจรูปแบบไฟล์')}
    if(!workbook.worksheets.length||workbook.worksheets.length>20)throw bad(400,'ไฟล์ต้องมี 1–20 แผ่นงาน')
    let total=0
    const sheets=workbook.worksheets.map((sheet,index)=>{
      if(sheet.columnCount>200)throw bad(400,'แต่ละตารางมีได้ไม่เกิน 200 คอลัมน์')
      const used=new Set<string>()
      const headers=Array.from({length:sheet.columnCount},(_,i)=>{
        const base=sheet.getRow(1).getCell(i+1).text.trim().slice(0,110)||`คอลัมน์ ${i+1}`
        let label=base,number=2
        while(used.has(label))label=`${base} (${number++})`
        used.add(label)
        return label
      })
      const data:string[][]=[]
      sheet.eachRow((row,rowIndex)=>{
        if(rowIndex===1)return
        const values=headers.map((_,i)=>row.getCell(i+1).text)
        if(values.some(v=>v!=='')){data.push(values);if(++total>5000)throw bad(400,'นำเข้าได้ไม่เกิน 5,000 แถวต่อไฟล์')}
      })
      return data.length?validSheet({name:sheet.name||`Sheet ${index+1}`,headers,rows:data}):null
    }).filter((sheet):sheet is Sheet=>sheet!==null)
    if(!sheets.length)throw bad(400,'ไฟล์ไม่มีข้อมูล')
    return {filename,sheets}
  })
  app.post('/api/datasets/confirm',async req=>{
    const owner=await actor(req),orgId=admin(owner),input=body(req),filename=text(input.filename,'ชื่อไฟล์',160)
    if(!Array.isArray(input.sheets)||!input.sheets.length||input.sheets.length>20)throw bad(400,'จำนวนแผ่นงานไม่ถูกต้อง')
    const sheets=input.sheets.map(validSheet)
    if(sheets.reduce((n,s)=>n+s.rows.length,0)>5000||JSON.stringify(sheets).length>12_000_000)throw bad(400,'ไฟล์มีข้อมูลมากเกินไป')
    return transaction(async client=>{
      const created:string[]=[]
      for(const sheet of sheets){
        const record=await client.query<{id:string}>('INSERT INTO customer_datasets(org_id,name,filename,headers,row_count,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [orgId,sheet.name,filename,JSON.stringify(sheet.headers),sheet.rows.length,owner.id])
        const datasetId=record.rows[0]!.id
        created.push(datasetId)
        for(let start=0;start<sheet.rows.length;start+=200){
          const batch=sheet.rows.slice(start,start+200)
          const params=batch.flatMap((values,i)=>[datasetId,start+i+1,encryptPersonal(JSON.stringify(values),config.PII_ENCRYPTION_KEY)])
          const placeholders=batch.map((_,i)=>`($${i*3+1},$${i*3+2},$${i*3+3})`).join(',')
          await client.query(`INSERT INTO customer_dataset_rows(dataset_id,row_number,ciphertext) VALUES ${placeholders}`,params)
        }
      }
      return {ids:created,datasets:created.length,rows:sheets.reduce((n,s)=>n+s.rows.length,0)}
    })
  })
  app.get('/api/datasets/:id',async req=>{
    const owner=await actor(req),orgId=admin(owner),datasetId=id(req)
    const dataset=await one<{id:string;name:string;filename:string;headers:string[];row_count:number;created_at:Date}>('SELECT id,name,filename,headers,row_count,created_at FROM customer_datasets WHERE id=$1 AND org_id=$2',[datasetId,orgId])
    if(!dataset)throw bad(404,'ไม่พบชุดข้อมูล')
    const rawOffset=Number((req.query as {offset?:string}).offset||0)
    const offset=Number.isSafeInteger(rawOffset)&&rawOffset>=0?rawOffset:0
    const page=await rows<{row_number:number;ciphertext:string}>('SELECT row_number,ciphertext FROM customer_dataset_rows WHERE dataset_id=$1 AND row_number>$2 ORDER BY row_number LIMIT 100',[datasetId,offset])
    const visible=page.map(row=>({row_number:row.row_number,values:JSON.parse(decryptPersonal(row.ciphertext,config.PII_ENCRYPTION_KEY)) as string[]}))
    await rows('INSERT INTO audit_events(org_id,actor_id,method,route,status) VALUES($1,$2,$3,$4,$5)',[orgId,owner.id,'GET','/api/datasets/:id',200])
    return {...dataset,rows:visible}
  })
  app.delete('/api/datasets/:id',async req=>{
    const orgId=admin(await actor(req))
    const deleted=await one('DELETE FROM customer_datasets WHERE id=$1 AND org_id=$2 RETURNING id',[id(req),orgId])
    if(!deleted)throw bad(404,'ไม่พบชุดข้อมูล')
    return {ok:true}
  })
}
