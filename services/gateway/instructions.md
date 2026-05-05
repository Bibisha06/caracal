# gateway

## Scope
- Covers the MCP reverse proxy service under caracal/services/gateway/ only.

## Required
- Must use Go 1.26 with net/http only; no external HTTP framework.
- Must listen on port 8081 only.
- Must read and follow caracal/plan/gateway/plan.md before any change; check off tasks as completed.
- Must perform a fresh STS exchange on every proxied request; must not cache tokens.
- Must use github.com/garudex-labs/caracal/shared/* for config, errors, and logging.

## Forbidden
- Must not import from caracalEnterprise/.
- Must not cache tokens at any layer.
- Must not log plaintext bearer tokens.
- Must not add features beyond plan.md checkboxes.
