import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import { pool, passwordHash, transaction } from './db.js'

const password=randomBytes(18).toString('base64url')
try {
  await mkdir(config.RUNTIME_DIR,{recursive:true,mode:0o700})
  const file=path.join(config.RUNTIME_DIR,'platform-credentials.txt'),pending=`${file}.${randomBytes(6).toString('hex')}.pending`
  await writeFile(pending,`organization: platform\nusername: platform\npassword: ${password}\n`,{mode:0o600})
  try {
    await transaction(async client=>{
      const updated=await client.query("UPDATE users SET password_hash=$1 WHERE role='platform' AND username='platform' RETURNING id",[await passwordHash(password)])
      if(!updated.rowCount)throw new Error('ไม่พบบัญชีแพลตฟอร์ม')
      await client.query('DELETE FROM sessions WHERE user_id=$1',[updated.rows[0]!.id])
      await rename(pending,file)
    })
  }catch(error){await rm(pending,{force:true});throw error}
  console.log(`ตั้งรหัสผ่านใหม่แล้ว อ่านได้ที่ ${file}`)
}finally{await pool.end()}
