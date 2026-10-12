import { randomBytes } from 'node:crypto'
import { rows, transaction, passwordHash } from './db.js'
import { removePrivate } from './storage.js'

type Expired = {user_id:string;org_id:string;identity_document_key:string;authorization_document_key:string}
export async function purgeExpiredProfiles(): Promise<number> {
  const expired=await rows<Expired>('SELECT user_id,org_id,identity_document_key,authorization_document_key FROM resident_profiles WHERE retention_at<=now() ORDER BY retention_at LIMIT 100')
  for(const p of expired) {
    await transaction(async client => {
      for(const key of [p.identity_document_key,p.authorization_document_key]) if(key)
        await client.query('INSERT INTO private_file_deletions(key) VALUES($1) ON CONFLICT DO NOTHING',[key])
      await client.query('DELETE FROM visitor_logs WHERE org_id=$1 AND user_id=$2',[p.org_id,p.user_id])
      await client.query('DELETE FROM resident_inspections WHERE org_id=$1 AND user_id=$2',[p.org_id,p.user_id])
      await client.query('DELETE FROM resident_complaints WHERE org_id=$1 AND user_id=$2',[p.org_id,p.user_id])
      await client.query('DELETE FROM resident_profiles WHERE org_id=$1 AND user_id=$2 AND retention_at<=now()',[p.org_id,p.user_id])
      await client.query('DELETE FROM sessions WHERE user_id=$1',[p.user_id])
      await client.query("UPDATE users SET name='อดีตผู้พัก',username='archived-'||left(id::text,12),password_hash=$1 WHERE id=$2 AND org_id=$3 AND role='resident'",
        [await passwordHash(randomBytes(32).toString('hex')),p.user_id,p.org_id])
      await client.query('INSERT INTO audit_events(org_id,target_id,method,route,status) VALUES($1,$2,$3,$4,$5)',[p.org_id,p.user_id,'PURGE','resident_profile',200])
    })
  }
  const queued=await rows<{key:string}>('SELECT key FROM private_file_deletions ORDER BY queued_at LIMIT 200')
  for(const item of queued) {
    await removePrivate(item.key)
    await rows('DELETE FROM private_file_deletions WHERE key=$1',[item.key])
  }
  return expired.length
}
