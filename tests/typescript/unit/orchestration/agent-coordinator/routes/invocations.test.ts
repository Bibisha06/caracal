// Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
// Caracal, a product of Garudex Labs
//
// Invocation route unit tests for idempotent creation and cancellation state.

import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { invocationsRoutes } from '../../../../../../apps/agent-coordinator/src/routes/invocations.js'

function buildApp() {
  const app = Fastify({ logger: false })
  const db = {
    query: vi.fn(),
    connect: vi.fn(),
  }
  app.decorate('db', db as never)
  app.decorate('redis', { xadd: vi.fn() } as never)
  app.register(invocationsRoutes, { prefix: '/v1' })
  return { app, db }
}

describe('POST /v1/zones/:zoneId/invocations', () => {
  it('creates a pending invocation and enqueues an outbox event', async () => {
    const { app, db } = buildApp()
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'svc-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'inv-1', zone_id: 'z1', service_id: 'svc-1', status: 'pending' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    }
    db.connect.mockResolvedValueOnce(client)

    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/zones/z1/invocations',
      payload: {
        service_id: 'svc-1',
        idempotency_key: 'idem-1',
        method: 'run',
        params: { task: 'summarize' },
      },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toMatchObject({ id: 'inv-1', status: 'pending' })
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('caracal_outbox'), expect.any(Array))
  })

  it('returns an existing invocation for the same idempotency key', async () => {
    const { app, db } = buildApp()
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'svc-1' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inv-existing', status: 'running' }] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    }
    db.connect.mockResolvedValueOnce(client)

    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/zones/z1/invocations',
      payload: {
        service_id: 'svc-1',
        idempotency_key: 'idem-1',
        method: 'run',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ id: 'inv-existing', status: 'running' })
  })

  it('rejects invocation sessions outside the zone', async () => {
    const { app, db } = buildApp()
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'svc-1' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    }
    db.connect.mockResolvedValueOnce(client)

    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/zones/z1/invocations',
      payload: {
        service_id: 'svc-1',
        source_session_id: 'agent-other-zone',
        idempotency_key: 'idem-1',
        method: 'run',
      },
    })

    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'agent_session_not_found' })
  })
})

describe('PATCH /v1/zones/:zoneId/invocations/:id/cancel', () => {
  it('records cancellation and emits an invocation event', async () => {
    const { app, db } = buildApp()
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'cancel_requested' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    }
    db.connect.mockResolvedValueOnce(client)

    await app.ready()
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/zones/z1/invocations/inv-1/cancel',
      payload: { reason: 'user_cancelled' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ id: 'inv-1', status: 'cancel_requested' })
    expect(client.query.mock.calls.some((call) => String(call[1]?.[1]).includes('invocation.cancel_requested'))).toBe(true)
  })
})