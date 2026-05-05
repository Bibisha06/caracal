// Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
// Caracal, a product of Garudex Labs
//
// PostgreSQL pool for the agent coordinator.

import pg from 'pg'
import { cfg } from './config.js'

export const db = new pg.Pool({ connectionString: cfg.databaseUrl })
