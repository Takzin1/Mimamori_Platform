# MimamoriPlatform — Core Contract

## Singular purpose

**One Case, one accountable owner at a time, and a verifiable result.**

### Essential invariants

1. Immutable Case lineage, scoped to one tenant and stable source signal.
2. Only valid transitions: NEW → ACKNOWLEDGED → ASSIGNED → IN_PROGRESS → COMPLETED → CLOSED; optional IN_PROGRESS → HANDOFF_PENDING → IN_PROGRESS.
3. Outgoing owner retains the assignee role until the requested incoming actor explicitly accepts.
4. Completion requires a valid outcome, a nonempty human explanation and at least one evidence reference. No autonomous confirmation.
5. Version conflicts must fail rather than silently overwrite a concurrent update.
6. Event replay must reproduce the Case aggregate; an event stream is the source of truth.
7. SLA and queue are projections, not secondary state machines.

### What stays outside Core

- Voice, LINE, questionnaires, dashboards, manuals, LMS, care charting, incident templates, generic platform configuration.
- AI decisions, clinical judgement, emergency dispatch, automated Case closure.
- Production identity, tenant membership and RBAC, access token handling, durable Postgres persistence, outbox notification providers, operations UI.

### Why not simply copy the whole CareOps repo?

Those services are real and valuable, but they are **application infrastructure**. Extract only the portable domain and projection logic. An authenticated CareOps server must bind and authorize actors before passing commands to this engine.

### Migration and non-divergence

1. Import the pure Core sources and original regression tests from public `mimamori-care-ops`.
2. Run `npm ci --ignore-scripts && npm run typecheck && npm test` on Node 24 or newer.
3. Compare old/new behavior, especially ownership transfer, evidence requirements, stale versions, deduplication and tenant-aware queue.
4. Decide packaging and versioning, then cut over the **existing** CareOps service to import this canonical engine in a separate reviewed PR.
5. Keep the original server authentication, membership, Postgres, outbox and operational runbooks; run their integration tests before any production cutover.
6. No real care data, credential copying, automatic migrations or production toggles during this extraction.

**MVP freeze:** If a proposed feature does not protect owner continuity, reliable progress or evidence-backed completion, it does not belong in this engine.

## Scope reduction (2026-11-21)

- Removed the facility SLA-policy directory from the portable engine: config lookup stays with the consuming application.
- Moved in-memory Case repository and its synthetic errors from `src/` to `tests/support/`: the fake never ships as part of the public Core surface.
- Excluded PostgREST transport/corruption errors from the Core package; these are service-adapter concerns.
- Added a boundary regression test: new UI, identity, network, deployment or other infrastructure modules must not enter this package.
- Introduced small PR CI to replace repetitive manual test execution, without modifying existing CareOps Actions.
