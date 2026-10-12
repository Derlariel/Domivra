import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { ZodError } from 'zod'
import { config } from './config.js'
import { initializeDatabase, pool } from './db.js'
import { registerAuthRoutes } from './auth.js'
import { registerCoreRoutes } from './routes-core.js'
import { registerFinanceRoutes } from './routes-finance.js'
import { registerWorkflowRoutes } from './routes-workflows.js'
import { registerImportRoutes } from './routes-import.js'
import { registerRegistryRoutes } from './routes-registry.js'
import { registerDatasetRoutes } from './routes-datasets.js'
import { actor } from './auth.js'
import { rows } from './db.js'
import { purgeExpiredProfiles } from './retention.js'

const app = Fastify({ logger: true, bodyLimit: 28_000_000, trustProxy: false })
await app.register(cookie)
app.addHook('onRequest', async (req) => {
  if (req.method !== 'GET' && req.url.startsWith('/api/')) {
    const origin = req.headers.origin
    if (origin && origin !== config.WEB_ORIGIN) throw Object.assign(new Error('คำขอจากแหล่งอื่นถูกปฏิเสธ'), { statusCode: 403 })
  }
})
app.setErrorHandler((error, _req, reply) => {
  const failure = error as Error & { statusCode?: number; code?: string }
  const status = error instanceof ZodError ? 400 : failure.statusCode || (failure.code === '23505' ? 409 : 500)
  if (status >= 500) app.log.error(error)
  reply.code(status).send({ error: status >= 500 ? 'ระบบขัดข้อง' : failure.message })
})
app.get('/api/health', async () => ({ ok: true }))
registerAuthRoutes(app)
registerCoreRoutes(app)
registerFinanceRoutes(app)
registerWorkflowRoutes(app)
registerImportRoutes(app)
registerRegistryRoutes(app)
registerDatasetRoutes(app)
app.addHook('onResponse', async (req, reply) => {
  if (!req.url.startsWith('/api/') || !['POST','PATCH','DELETE'].includes(req.method) || reply.statusCode >= 400) return
  try {
    const user = await actor(req)
    const route=req.routeOptions.url || req.url.split('?')[0] || req.url
    const target=route.startsWith('/api/residents/:id')?String((req.params as {id?:string}).id||''):route.startsWith('/api/my/')?user.id:null
    await rows('INSERT INTO audit_events(org_id,actor_id,target_id,method,route,status) VALUES($1,$2,$3,$4,$5,$6)',
      [user.org_id,user.id,target,req.method,route,reply.statusCode])
  } catch (error) { app.log.error(error,'Audit event not recorded') }
})
await initializeDatabase()
await purgeExpiredProfiles().catch(error=>app.log.error(error,'Retention cleanup will retry after startup'))
const retentionTimer=setInterval(()=>{purgeExpiredProfiles().catch(error=>app.log.error(error,'Retention cleanup failed'))},24*60*60*1000)
await app.listen({ host: '0.0.0.0', port: config.API_PORT })
const shutdown = async () => { clearInterval(retentionTimer); await app.close(); await pool.end() }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
