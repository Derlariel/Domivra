import type { FastifyInstance } from 'fastify'
import { actor, admin, bad, org, resident } from './auth.js'
import { one, rows, transaction } from './db.js'
import { body, id, text, optional, amount } from './http.js'
import { fileDataUrl, getPrivate, putPrivate, removePrivate } from './storage.js'

export function registerFinanceRoutes(app: FastifyInstance): void {
  app.get('/api/invoices', async req => {
    const user=await actor(req),orgId=org(user)
    return user.role==='admin' ? rows(`SELECT i.*,u.number,us.name resident FROM invoices i JOIN units u ON u.id=i.unit_id LEFT JOIN users us ON us.unit_id=u.id AND us.role='resident' WHERE i.org_id=$1 ORDER BY i.period DESC,u.number`,[orgId])
      : rows(`SELECT i.*,u.number FROM invoices i JOIN units u ON u.id=i.unit_id WHERE i.org_id=$1 AND i.status<>'draft' AND (i.unit_id=$2 OR EXISTS(SELECT 1 FROM contracts c WHERE c.user_id=$3 AND c.unit_id=i.unit_id AND i.period BETWEEN to_char(c.start_date,'YYYY-MM') AND to_char(c.end_date,'YYYY-MM'))) ORDER BY i.period DESC`,[orgId,user.unit_id,user.id])
  })
  app.post('/api/invoices', async req => {
    const orgId=admin(await actor(req)),d=body(req),unitId=String(d.unit_id),period=text(d.period,'งวดบิล',7),due=text(d.due,'วันครบกำหนด',10)
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||!/^\d{4}-\d{2}-\d{2}$/.test(due))throw bad(400,'วันที่ไม่ถูกต้อง')
    if(!await one('SELECT id FROM units WHERE id=$1 AND org_id=$2',[unitId,orgId]))throw bad(404,'ไม่พบห้อง')
    return one(`INSERT INTO invoices(org_id,unit_id,period,rent,water,electric,other,due,water_previous,water_current,electric_previous,electric_current)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[orgId,unitId,period,amount(d.rent??0,'ค่าเช่า'),amount(d.water??0,'ค่าน้ำ'),amount(d.electric??0,'ค่าไฟ'),amount(d.other??0,'อื่นๆ'),due,...['water_previous','water_current','electric_previous','electric_current'].map(k=>d[k]==null||d[k]===''?null:amount(d[k],k))])
  })
  app.patch('/api/invoices/:id', async req => {const orgId=admin(await actor(req)),d=body(req);const result=await one(`UPDATE invoices SET rent=$1,water=$2,electric=$3,other=$4,due=$5 WHERE id=$6 AND org_id=$7 AND status='draft' RETURNING id`,[amount(d.rent,'ค่าเช่า'),amount(d.water,'ค่าน้ำ'),amount(d.electric,'ค่าไฟ'),amount(d.other,'อื่นๆ'),text(d.due,'วันครบกำหนด',10),id(req),orgId]);if(!result)throw bad(409,'แก้ไขได้เฉพาะบิลฉบับร่าง');return {ok:true}})
  app.post('/api/invoices/:id/publish', async req => {const orgId=admin(await actor(req));const result=await one("UPDATE invoices SET status='published' WHERE id=$1 AND org_id=$2 AND status='draft' RETURNING id",[id(req),orgId]);if(!result)throw bad(409,'เผยแพร่ได้เฉพาะฉบับร่าง');return {ok:true}})
  app.get('/api/payments', async req => {const user=await actor(req),orgId=org(user);return user.role==='admin'?rows('SELECT p.*,i.period,u.number,us.name FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN units u ON u.id=i.unit_id JOIN users us ON us.id=p.user_id WHERE p.org_id=$1 ORDER BY p.created_at DESC',[orgId]):rows('SELECT p.*,i.period FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.org_id=$1 AND p.user_id=$2 ORDER BY p.created_at DESC',[orgId,user.id])})
  app.post('/api/payments', async req => {
    const user=await actor(req),orgId=resident(user),d=body(req),invoiceId=String(d.invoice_id),paidAmount=amount(d.amount,'ยอดชำระ'),file=fileDataUrl(d.evidence)
    const invoice=await one<{id:string;amount:string;paid:string}>(`SELECT i.id,i.amount,coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='verified'),0) paid FROM invoices i WHERE i.id=$1 AND i.org_id=$2 AND i.unit_id=$3 AND i.status='published'`,[invoiceId,orgId,user.unit_id])
    if(!invoice)throw bad(404,'ไม่พบบิลที่ชำระได้')
    if(await one('SELECT id FROM payments WHERE invoice_id=$1 AND status=$2',[invoiceId,'pending']))throw bad(409,'มีรายการรอตรวจแล้ว')
    if(Number(paidAmount)>Number(invoice.amount)-Number(invoice.paid))throw bad(409,'ยอดชำระเกินยอดคงเหลือ')
    const key=await putPrivate(orgId,'payments',file)
    try {return await one('INSERT INTO payments(org_id,invoice_id,user_id,amount,evidence_key,sender,transferred_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[orgId,invoiceId,user.id,paidAmount,key,optional(d.sender,100)||user.name,d.transferred_at||null])}
    catch(error){await removePrivate(key);throw error}
  })
  app.post('/api/payments/:id/review', async req => {
    const orgId=admin(await actor(req)),d=body(req),paymentId=id(req)
    if(!['verified','rejected'].includes(String(d.status)))throw bad(400,'สถานะไม่ถูกต้อง')
    if(d.status==='verified'&&(d.confirmed!==true||amount(d.actual_amount,'ยอดชำระ')===''||!optional(d.reference,100)))throw bad(400,'กรุณายืนยันยอดและเลขอ้างอิง')
    if(d.status==='rejected'&&!optional(d.note,300))throw bad(400,'กรุณาระบุเหตุผล')
    return transaction(async client=>{
      const payment=await client.query<{amount:string;invoice_id:string}>('SELECT amount,invoice_id FROM payments WHERE id=$1 AND org_id=$2 AND status=$3 FOR UPDATE',[paymentId,orgId,'pending'])
      if(!payment.rows[0])throw bad(409,'รายการนี้ตรวจแล้ว')
      if(d.status==='verified' && Number(amount(d.actual_amount,'ยอดชำระ'))!==Number(payment.rows[0].amount))throw bad(400,'ยอดไม่ตรง')
      await client.query('UPDATE payments SET status=$1,note=$2,transfer_reference=$3 WHERE id=$4',[d.status,optional(d.note,300),optional(d.reference,100),paymentId])
      if(d.status==='verified'){
        const bill=await client.query<{amount:string;paid:string}>(`SELECT i.amount,coalesce((SELECT sum(amount) FROM payments WHERE invoice_id=i.id AND status='verified'),0) paid FROM invoices i WHERE i.id=$1 FOR UPDATE`,[payment.rows[0].invoice_id])
        if(Number(bill.rows[0]!.paid)>Number(bill.rows[0]!.amount))throw bad(409,'ยอดชำระเกินบิล')
        if(Number(bill.rows[0]!.paid)===Number(bill.rows[0]!.amount))await client.query("UPDATE invoices SET status='paid' WHERE id=$1",[payment.rows[0].invoice_id])
      }
      return {ok:true}
    })
  })
  app.get('/api/evidence/:id', async (req,reply) => {
    const user=await actor(req),orgId=org(user),payment=await one<{evidence_key:string;user_id:string}>('SELECT evidence_key,user_id FROM payments WHERE id=$1 AND org_id=$2',[id(req),orgId])
    if(!payment||(user.role!=='admin'&&payment.user_id!==user.id))throw bad(404,'ไม่พบหลักฐาน')
    const data=await getPrivate(payment.evidence_key),type=payment.evidence_key.endsWith('.pdf')?'application/pdf':payment.evidence_key.endsWith('.png')?'image/png':'image/jpeg'
    reply.header('Content-Type',type).header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').send(data)
  })
}
