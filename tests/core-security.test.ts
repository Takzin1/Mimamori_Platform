import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEvent, canCaseCommand, createCase, executeCommand, InvalidTransitionError, replayCase,
  type CaseCommand, type CaseEvent,
} from "../src/core/index.ts";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 6, minute)).toISOString();

function fixture() {
  const events: CaseEvent[] = [];
  let { aggregate, event } = createCase({
    id: "test-case", tenantId: "test-facility", subjectId: "test-person",
    sourceAdapter: "test", sourceSignalId: "test-signal", sourceType: "manual",
    priority: "normal", createdAt: at(0),
  });
  events.push(event);
  const move = (command: CaseCommand, minute: number) => {
    ({ aggregate, event } = executeCommand(aggregate, aggregate.version, command, at(minute)));
    events.push(event);
  };
  move({ type: "acknowledge", actorId: "dispatcher" }, 1);
  move({ type: "assign", actorId: "dispatcher", assigneeId: "owner-a" }, 2);
  move({ type: "start_action", actorId: "owner-a" }, 3);
  return { events, aggregate, move, current: () => aggregate };
}

test("valid event stream still replays to the same Case", () => {
  const f = fixture();
  f.move({ type: "request_handoff", actorId: "owner-a", targetAssigneeId: "owner-b" }, 4);
  f.move({ type: "accept_handoff", actorId: "owner-b" }, 5);
  f.move({ type: "complete", actorId: "owner-b", outcome: "confirmed_safe",
    summary: "Synthetic confirmation", evidence: [{ kind: "call", ref: "synthetic:call:01" }] }, 6);
  assert.deepEqual(replayCase(f.events), f.current());
});

test("forged handoff acceptance cannot rewrite the previous owner", () => {
  const f = fixture();
  f.move({ type: "request_handoff", actorId: "owner-a", targetAssigneeId: "owner-b" }, 4);
  const forged = { type: "handoff_accepted", actorId: "owner-b", at: at(5),
    sequence: f.current().version + 1, data: { previousAssigneeId: "other-person" } } as CaseEvent;
  assert.throws(() => applyEvent(f.current(), forged), InvalidTransitionError);
  assert.throws(() => replayCase([...f.events, forged]), InvalidTransitionError);
  assert.equal(f.current().assigneeId, "owner-a");
});

test("completion replay rejects empty or malformed evidence and summary", () => {
  const f = fixture();
  const original = executeCommand(f.current(), f.current().version,
    { type: "complete", actorId: "owner-a", outcome: "confirmed_safe", summary: "Synthetically checked",
      evidence: [{ kind: "note", ref: "synthetic:proof" }] }, at(4)).event;
  assert.equal(original.type, "completed");
  if (original.type !== "completed") return;
  for (const data of [
    { ...original.data, evidence: [] },
    { ...original.data, evidence: [{ kind: "note", ref: "   " }] },
    { ...original.data, evidence: [{ kind: "forged", ref: "synthetic" }] },
    { ...original.data, evidence: null },
    { ...original.data, summary: "   " },
    { ...original.data, outcome: "unrecognized" },
  ]) {
    const event = { ...original, data } as unknown as CaseEvent;
    assert.throws(() => applyEvent(f.current(), event), InvalidTransitionError);
  }
});

test("malformed origin and command fields fail closed at runtime", () => {
  const f = fixture();
  const first = f.events[0];
  assert.ok(first && first.type === "case_created");
  for (const bad of [
    { ...first, at: "not-a-date" },
    { ...first, actorId: "forged-creator" },
    { ...first, data: { ...first.data, priority: "escalate-now" } },
    { ...first, data: { ...first.data, tenantId: "" } },
  ]) {
    assert.throws(() => replayCase([bad as CaseEvent]), InvalidTransitionError);
  }
  for (const bad of [
    { type: "noop", actorId: "owner-a" },
    { type: "set_priority", actorId: "owner-a", priority: "impossible" },
  ]) {
    assert.throws(() => executeCommand(f.current(), f.current().version,
      bad as CaseCommand, at(4)), InvalidTransitionError);
  }
  assert.equal(canCaseCommand(f.current(), "owner-a", "noop" as CaseCommand["type"]), false);
  assert.throws(() => createCase({
    id: "synthetic-bad", tenantId: "test", subjectId: "test", sourceType: "invalid" as never,
    sourceAdapter: "test", sourceSignalId: "bad", priority: "normal", createdAt: at(0),
  }), InvalidTransitionError);
});

test("replayed event timestamp cannot precede Case creation", () => {
  const f = fixture();
  const second = f.events[1];
  assert.ok(second);
  const altered = { ...second, at: new Date(Date.UTC(2026, 10, 20)).toISOString() } as CaseEvent;
  assert.throws(() => replayCase([f.events[0]!, altered]), InvalidTransitionError);
});

test("completion snapshot does not share mutable evidence with emitted event", () => {
  const f = fixture();
  const answer = executeCommand(f.current(), f.current().version,
    { type: "complete", actorId: "owner-a", outcome: "confirmed_safe",
      summary: "Synthetic", evidence: [{ kind: "note", ref: "synthetic:proof" }] }, at(4));
  assert.equal(answer.event.type, "completed");
  if (answer.event.type !== "completed") return;
  answer.event.data.evidence[0]!.ref = "altered:after";
  assert.equal(answer.aggregate.completion?.evidence[0]?.ref, "synthetic:proof");
});

test("unknown event type cannot silently advance state version", () => {
  const f = fixture();
  const event = { type: "sneaky", actorId: "owner-a", data: {}, sequence: f.current().version + 1, at: at(4) } as unknown as CaseEvent;
  assert.throws(() => applyEvent(f.current(), event), InvalidTransitionError);
});
