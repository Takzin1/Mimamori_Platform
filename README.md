# MimamoriPlatform

> **対応を、最後までつなぐ。**
> A small Case Core Engine with optional external inputs.

**MimamoriPlatform is the proposed canonical Core Engine** for Mimamori's care-focused MVP. This initial implementation extracts the proven, pure domain modules from the **public** [mimamori-care-ops](https://github.com/Takzin1/mimamori-care-ops) repository without changing Case state semantics.

## What the engine does

受付 → 確認 → 担当決定 → 対応 → (必要時のみ) 引き継ぎ → 証跡付き完了 → 終了確認

- Case creation and immutable source identity
- Explicit assignee responsibility, two-phase handoff and acceptance
- Evidence-backed completion and independent close/reopen
- Event replay, optimistic version checks and deterministic SLA/queue projections
- Repository interface and **synthetic-test-only** in-memory storage

## Run tests

Node.js 24+ is required. This is TypeScript code, not a web server or a mobile app.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

Import directly from `src/index.ts` in a compatible TypeScript/Node environment. Integration with another repository will require a tested packaging/versioning decision; publishing a package is **not** part of this MVP.

## Architecture

```text
    Mimamori App / Voice / LINE / web intake      [optional adapters; future]
                    |
      verified identity / tenant membership      [existing CareOps boundary]
                    |
            MIMAMORI PLATFORM CORE
           Case / owner / handoff / evidence
                 /             \
          queue + SLA        event replay
                    |
             repository port
                    |
       durable persistence / outbox               [existing CareOps boundary]
```

## Deliberate non-features

No care-charting or billing suite, LMS, manual editor, chat platform, no-code workflow builder, voice transcription, clinical AI decisions, or plugin marketplace. Framework interoperability is an interface concern, not permission to make the engine grow indiscriminately.

## Security and maturity

**This repository alone is NOT a production care service.** It contains no login, authentication, authorization, durable storage or notification worker. The pure functions accept `actorId`/`tenantId` provided by their caller: they are **not** identity verification. Real deployment must preserve CareOps' authenticated API, membership/RBAC checks, safe tenant isolation, transactional store, audit/outbox and recovery.

Never store real resident data in the in-memory test repository, and never perform autonomous clinical judgement or automatic handoff acceptance/closure.

**See [Core contract](docs/CORE_CONTRACT.md)** for invariants and the integration gate.

## Provenance

Copied from the public `Takzin1/mimamori-care-ops` `main` branch on 2026-11-21. Existing Case/SLA/persistence regression tests are carried over with their implementations. The previous service remains operational source of truth until a verified consumer integration is complete. This repository does not change that deployment.
