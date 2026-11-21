import assert from "node:assert/strict";
import test from "node:test";
import {
  createCase, executeCommand, InMemoryCaseRepository, projectCaseQueue,
  InvalidTransitionError, type CaseCommand, type CaseSlaPolicy,
} from "../src/index.ts";

const duration = {
  acknowledgeWithinMs: 60000, assignWithinMs: 60000,
  firstActionWithinMs: 60000, handoffAcceptWithinMs: 60000,
  completeWithinMs: 180000,
};
const policy: CaseSlaPolicy = {
  critical: duration, high: duration, normal: duration, low: duration,
};
const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 1, minute)).toISOString();

test("portable core keeps accountability and evidence across an isolated tenant queue", async () => {
  const repo = new InMemoryCaseRepository();
  const first = createCase({
    id: "synthetic-case", tenantId: "facility-a", subjectId: "synthetic-subject",
    sourceAdapter: "synthetic", sourceSignalId: "synthetic-signal-a",
    sourceType: "manual", priority: "normal", createdAt: at(0),
  });
  const other = createCase({
    id: "synthetic-case", tenantId: "facility-b", subjectId: "other-synthetic-subject",
    sourceAdapter: "synthetic", sourceSignalId: "synthetic-signal-b",
    sourceType: "manual", priority: "normal", createdAt: at(0),
  });
  await repo.create(first.event);
  await repo.create(other.event);
  assert.equal((await repo.list("facility-a")).length, 1);
  assert.equal((await repo.load("facility-a", "synthetic-case"))?.aggregate.tenantId, "facility-a");
  assert.equal((await repo.load("facility-b", "synthetic-case"))?.aggregate.tenantId, "facility-b");
  let aggregate = first.aggregate;
  const advance = async (command: CaseCommand, minute: number) => {
    const result = executeCommand(aggregate, aggregate.version, command, at(minute));
    await repo.append({ tenantId: "facility-a", caseId: aggregate.id,
      expectedVersion: aggregate.version, event: result.event });
    aggregate = result.aggregate;
  };
  await advance({ type: "acknowledge", actorId: "dispatcher" }, 1);
  await advance({ type: "assign", actorId: "dispatcher", assigneeId: "staff-a" }, 2);
  await advance({ type: "start_action", actorId: "staff-a" }, 3);
  await advance({ type: "request_handoff", actorId: "staff-a", targetAssigneeId: "staff-b" }, 4);
  assert.equal(aggregate.status, "HANDOFF_PENDING");
  assert.equal(aggregate.assigneeId, "staff-a");
  assert.equal(aggregate.handoffTargetId, "staff-b");
  const waiting = projectCaseQueue(await repo.list("facility-a"), "facility-a",
    { type: "tenant" }, policy, at(5));
  assert.equal(waiting.summary.handoffPending, 1);
  assert.equal(waiting.items[0]?.assigneeId, "staff-a");
  assert.equal(waiting.items[0]?.handoffTargetId, "staff-b");
  await advance({ type: "accept_handoff", actorId: "staff-b" }, 6);
  assert.equal(aggregate.assigneeId, "staff-b");
  assert.throws(() => executeCommand(aggregate, aggregate.version,
    { type: "complete", actorId: "staff-b", outcome: "confirmed_safe",
      summary: "synthetic", evidence: [] }, at(7)), InvalidTransitionError);
  await advance({ type: "complete", actorId: "staff-b", outcome: "confirmed_safe",
    summary: "Synthetic safety confirmation",
    evidence: [{ kind: "note", ref: "synthetic:proof" }] }, 7);
  assert.equal(aggregate.completion?.evidence.length, 1);
  const finished = projectCaseQueue(await repo.list("facility-a"), "facility-a",
    { type: "tenant" }, policy, at(8));
  assert.equal(finished.summary.total, 0);
  assert.equal((await repo.list("facility-b")).length, 1);
});
