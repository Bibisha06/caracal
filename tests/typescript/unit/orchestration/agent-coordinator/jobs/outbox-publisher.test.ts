// Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
// Caracal, a product of Garudex Labs
//
// Agent coordinator outbox publisher unit tests for Redis stream delivery.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startOutboxPublisher } from '../../../../../../apps/agent-coordinator/src/jobs/outbox-publisher.js'

describe('startOutboxPublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes pending outbox rows and marks them published', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { id: 'outbox-1', topic: 'caracal.invocations', payload_json: { event: 'created', count: 1 } },
        ] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    }
    const db = { connect: vi.fn().mockResolvedValueOnce(client) }
    const redis = { xadd: vi.fn().mockResolvedValueOnce('stream-id-1') }

    const timer = startOutboxPublisher(db as never, redis as never)
    await vi.advanceTimersByTimeAsync(1000)
    clearInterval(timer)

    expect(redis.xadd).toHaveBeenCalledWith('caracal.invocations', '*', 'event', 'created', 'count', '1')
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'published'"), ['outbox-1'])
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('records retry state when Redis publishing fails', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { id: 'outbox-1', topic: 'caracal.invocations', payload_json: { nested: { id: 'inv-1' } } },
        ] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    }
    const db = { connect: vi.fn().mockResolvedValueOnce(client) }
    const redis = { xadd: vi.fn().mockRejectedValueOnce(new Error('redis down')) }

    const timer = startOutboxPublisher(db as never, redis as never)
    await vi.advanceTimersByTimeAsync(1000)
    clearInterval(timer)

    expect(redis.xadd).toHaveBeenCalledWith('caracal.invocations', '*', 'nested', '{"id":"inv-1"}')
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = CASE WHEN attempts + 1 >= 10"), ['outbox-1'])
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})