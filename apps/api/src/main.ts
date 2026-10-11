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
await initializeDatabase()
await app.listen({ host: '0.0.0.0', port: config.API_PORT })
const shutdown = async () => { await app.close(); await pool.end() }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
