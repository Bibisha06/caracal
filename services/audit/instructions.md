# audit

## Scope
- Covers the audit consumer service under caracal/services/audit/ only.

## Required
- Must use Go 1.26.
- Must listen on port 9090 (health) only.
- Must read and follow caracal/plan/audit/plan.md before any change; check off tasks as completed.
- Must consume from caracal.audit.events using consumer group audit-ingestor.
- Must XACK only after successful PG INSERT.
- Must not UPDATE or DELETE rows in audit_events.
- Must use github.com/garudex-labs/caracal/shared/* for config, errors, and logging.

## Forbidden
- Must not import from caracalEnterprise/.
- Must not store plaintext claims, tokens, or PII.
- Must not add features beyond plan.md checkboxes.
