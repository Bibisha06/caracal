// Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
// Caracal, a product of Garudex Labs
//
// Agent coordinator configuration.

function mustGetenv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`required env var missing: ${key}`)
  return v
}

export const cfg = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  databaseUrl: mustGetenv('DATABASE_URL'),
  redisUrl: mustGetenv('REDIS_URL'),
  stsUrl: mustGetenv('STS_URL'),
  issuerUrl: process.env.ISSUER_URL ?? mustGetenv('STS_URL'),
  audience: process.env.AGENT_COORDINATOR_AUDIENCE ?? 'caracal.agent-coordinator',
  requiredScope: process.env.AGENT_COORDINATOR_SCOPE ?? 'agent:lifecycle',
}
