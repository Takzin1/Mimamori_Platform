# MimamoriPlatform

> **対応を、最後までつなぐ。**  
> The minimal, reusable Case Core Engine for Mimamori.

MimamoriPlatform is the canonical destination for the **Mimamori Core Engine**. The first implementation is extracted from the **public** [mimamori-care-ops](https://github.com/Takzin1/mimamori-care-ops) repository with the original Case semantics preserved.

## Scope

**Core does:** case intake state, acknowledgement, assignment, action, explicit handoff acceptance, evidence-backed completion, close/reopen, event replay, SLA/queue projection and a storage contract. Case handoff keeps the outgoing owner accountable until the incoming owner accepts.

**Core does not:** care charts, billing, manuals, LMS, social messaging, voice/LLM runtime, a no-code workflow builder or a general plugin marketplace. These are not necessary for a Case to reach verifiable completion.

## Safety / maturity

- **Engine only:** not a deployed, authenticated care operations service. Production identity, RBAC, tenant membership checks, durable persistence, outbox, operating procedures and privacy controls remain in [mimamori-care-ops](https://github.com/Takzin1/mimamori-care-ops) until separately integrated and tested.
- The in-memory repository is **only for tests and synthetic scenarios**, never care data.
- `actorId` passed to the pure engine is **not authenticated**; a trusted server must bind it to verified identity, tenant membership and command authorization.
- A Case can only be marked completed with a valid outcome, explanation and evidence references. No automated clinical/emergency decisions are provided.
- This is a new public repository: do not commit real personal data, secrets, private project files or real care records.

## Code status

The first extraction PR will add standalone TypeScript code and existing behavioral regression tests. Until that PR is merged, this `main` branch is a project declaration, **not a functioning engine**.

## Architecture

```text
Mimamori app / voice / LINE / external signals   [future adapters]
                    |
            authenticated API / RBAC              [integration task]
                    |
          MimamoriPlatform Core Engine
    CASE + ownership + acceptance + evidence
          |                       |
     Queue / SLA             Event replay
          |
      repository port
          |
  durable DB / outbox / operations               [integration task]
```

**Development rule:** Do not add a feature unless it protects the continuity or verifiability of the response. Maintain the Framework connection seam, but do not build a generic platform before validating the care-facility MVP.
