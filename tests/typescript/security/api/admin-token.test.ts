// Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
// Caracal, a product of Garudex Labs
//
// API admin-token security tests for protected management routes.

import { describe, it, expect, vi } from 'vitest'
import { buildApp } from '../../../../apps/api/src/app.js'

function deps() {
  const db = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }
  const redis = {
    xadd: vi.fn(),
  }
  const cfg = {
    port: 0,
    databaseUrl: 'postgres://localhost/caracal',
    redisUrl: 'redis://localhost:6379',
    logLevel: 'silent',
    adminToken: 'admin-secret',
  }
  return { cfg, db, redis }
}

describe('API admin token enforcement', () => {
  it('allows health checks without admin credentials', async () => {
    const { cfg, db, redis } = deps()
    const app = await buildApp({ cfg, db: db as never, redis: redis as never })

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    await app.close()
  })

  it('rejects protected management routes before DB access', async () => {
    const { cfg, db, redis } = deps()
    const app = await buildApp({ cfg, db: db as never, redis: redis as never })

    const res = await app.inject({ method: 'GET', url: '/v1/zones' })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid_admin_token' })
    expect(db.query).not.toHaveBeenCalled()
    await app.close()
  })

  it('allows protected management routes with the exact bearer token', async () => {
    const { cfg, db, redis } = deps()
    const app = await buildApp({ cfg, db: db as never, redis: redis as never })

    const res = await app.inject({
      method: 'GET',
      url: '/v1/zones',
      headers: { authorization: 'Bearer admin-secret' },
    })

    expect(res.statusCode).toBe(200)
    expect(db.query.mock.calls[0][0]).toContain('FROM zones')
    await app.close()
  })
})