# MimamoriPlatform — Core security boundary

## P0: malformed or forged event replay (this PR)

Pure Case state is not a security boundary by itself: it receives typed JavaScript objects, which may contain invalid runtime data after JSON decoding or DB loading. The pure Core MUST reject malformed records before replay, preserve ownership across two-phase handoff, and refuse evidence-free completion.

### Added fail-closed guards

- Case creation: nonblank bounded identifiers, valid source/priority enums, parseable ISO event timestamp, null creation actor.
- Other events: valid envelope, monotonically incrementing sequence, bounded actor id, parseable timestamp not before original Case creation.
- Responsibility: valid assignment target, no self-handoff, current-owner check, accepted handoff must carry the actual outgoing actor in `previousAssigneeId`.
- Completion: allowlisted outcome, nonblank bounded summary, 1-100 valid typed evidence items with bounded refs; resulting aggregate takes an independent evidence snapshot.
- Unknown command/event types and invalid enum values fail with `InvalidTransitionError` rather than silently ignoring or recording undefined state.

### Constraints and non-goals

- **No real identity verification:** `actorId`, `tenantId`, staff roles and membership remain trusted server inputs. The core cannot establish authorization, prevent a forged API request, or validate that the next assignee belongs to the same tenant.
- **No cryptographic tamper evidence:** a malicious database operator who can rewrite the entire event stream into a well-formed alternate history is outside this PR. Append-only DB privileges, audit export/retention, chain hashing/signing, access logs and operational monitoring require separately reviewed storage integration.
- **No DoS claim:** small bounds limit accidental/hostile field sizes, but request limits, rate limiting, memory and queue budgets belong to the HTTP/service layer.
- Timestamp checks validate shape/parseability and reject before-creation events. They do not provide trusted timestamps, clock synchronization or a global monotonic time guarantee.
- Neither the in-memory fixture nor the pure Core exports implement secure production persistence.
- No clinical decisions, AI acceptance/closure, automatic emergency escalation or external messaging.

### Compatibility gate before consumption by CareOps

1. Run Node 24 CI: typecheck, all pure Core regression tests and P0 attack tests.
2. Inventory and test every serialized event type currently in the old CareOps Postgres store; new bounds/ISO timestamp validation can reject records emitted by earlier versions, and the cutover **must not** silently drop them.
3. Verify server actor binding, staff membership/RBAC, expected-version CAS, two-phase handoff, completed evidence, event replay, outbox and PostgreSQL integration with the real persistence adapter.
4. Run adversarial tests for unauthorized actors, cross-tenant access, stale versions, replay injection and audit event tampering against the **server**, not only the pure Core.
5. Obtain a real security/privacy review and facility governance approval before resident or care data is involved.

Related standards: OWASP ASVS v5 validation/business logic, authorization and logging protections. See https://github.com/OWASP/ASVS and https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html.
