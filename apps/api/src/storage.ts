import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { randomBytes } from 'node:crypto'
import { config } from './config.js'
import { bad } from './auth.js'

const client = new S3Client({ region: config.S3_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY } })
let ready: Promise<void> | undefined
async function bucket(): Promise<void> {
  ready ??= (async () => {
    try { await client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })) }
    catch { await client.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET })) }
  })().catch(error => { ready=undefined; throw error })
  await ready
}
export function fileDataUrl(value: unknown, pdfOnly = false): { buffer: Buffer; type: string; ext: string } {
  if (typeof value !== 'string') throw bad(400,'กรุณาแนบไฟล์')
  const match = /^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(value)
  if (!match || (pdfOnly && match[1] !== 'application/pdf')) throw bad(400,'ชนิดไฟล์ไม่ถูกต้อง')
  const buffer = Buffer.from(match[2]!, 'base64'), type = match[1]!
  if (!buffer.length || buffer.length > 4_000_000) throw bad(400,'ไฟล์ต้องไม่เกิน 4 MB')
  const valid = type==='application/pdf' ? buffer.subarray(0,4).toString()==='%PDF' : type==='image/png' ? buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) : buffer.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))
  if (!valid) throw bad(400,'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์')
  return {buffer,type,ext:type==='application/pdf'?'pdf':type==='image/png'?'png':'jpg'}
}
export async function putPrivate(orgId: string, kind: string, file: {buffer:Buffer;type:string;ext:string}): Promise<string> {
  await bucket()
  const key=`${orgId}/${kind}/${randomBytes(18).toString('hex')}.${file.ext}`
  await client.send(new PutObjectCommand({Bucket:config.S3_BUCKET,Key:key,Body:file.buffer,ContentType:file.type,ServerSideEncryption:'AES256'}))
  return key
}
export async function getPrivate(key: string): Promise<Buffer> {
  const result=await client.send(new GetObjectCommand({Bucket:config.S3_BUCKET,Key:key}))
  if (!result.Body) throw bad(404,'ไม่พบไฟล์')
  return Buffer.from(await result.Body.transformToByteArray())
}
export async function removePrivate(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:key}))
}
