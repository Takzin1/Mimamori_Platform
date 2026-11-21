import {
  CASE_COMMAND_TYPES,
  CASE_PRIORITIES,
  COMPLETION_OUTCOMES,
  EVIDENCE_KINDS,
  SIGNAL_TYPES,
  type CaseAggregate,
  type CaseCommand,
  type CaseCommandType,
  type CaseCreatedEvent,
  type CaseEvent,
  type NewCaseInput,
} from "./types.ts";
import {
  CaseConflictError,
  InvalidTransitionError,
} from "./errors.ts";

function requireText(value: unknown, label: string, maxLength = 4000): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new InvalidTransitionError(`Invalid ${label}`);
  }
  const normalized = value.trim();
  if (!normalized || /[\u0000\u007f]/.test(normalized)) {
    throw new InvalidTransitionError(`Invalid ${label}`);
  }
  return normalized;
}

function requireEnum(value: unknown, allowed: readonly string[], label: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new InvalidTransitionError(`Invalid ${label}`);
  }
}

function requireEventTime(value: unknown): number {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new InvalidTransitionError("Invalid event timestamp");
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new InvalidTransitionError("Invalid event timestamp");
  }
  return time;
}

function requireEvidence(value: unknown): { kind: "note" | "call" | "visit" | "message" | "external_ref"; ref: string }[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new InvalidTransitionError("Completion requires 1 to 100 evidence items");
  }
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new InvalidTransitionError("Invalid evidence item");
    }
    const record = item as { kind?: unknown; ref?: unknown };
    requireEnum(record.kind, EVIDENCE_KINDS, "evidence kind");
    return {
      kind: record.kind as "note" | "call" | "visit" | "message" | "external_ref",
      ref: requireText(record.ref, "evidence ref", 1000),
    };
  });
}

function requireStatus(
  aggregate: CaseAggregate,
  ...allowed: CaseAggregate["status"][]
): void {
  if (!allowed.includes(aggregate.status)) {
    throw new InvalidTransitionError(
      `Cannot transition from ${aggregate.status}; expected ${allowed.join(" or ")}`,
    );
  }
}

function requireCurrentAssignee(
  aggregate: CaseAggregate,
  actorId: string,
): void {
  if (!aggregate.assigneeId || aggregate.assigneeId !== actorId) {
    throw new InvalidTransitionError(
      "Only the current assignee may perform this transition",
    );
  }
}

export function assertCaseCommandAvailable(
  aggregate: CaseAggregate,
  actorId: string,
  type: CaseCommandType,
): void {
  const actor = requireText(actorId, "actor id", 128);
  requireEnum(type, CASE_COMMAND_TYPES, "Case command");

  switch (type) {
    case "set_priority":
      requireStatus(
        aggregate,
        "NEW",
        "ACKNOWLEDGED",
        "ASSIGNED",
        "IN_PROGRESS",
        "HANDOFF_PENDING",
      );
      return;

    case "acknowledge":
      requireStatus(aggregate, "NEW");
      return;

    case "assign":
      requireStatus(aggregate, "ACKNOWLEDGED");
      return;

    case "start_action":
      requireStatus(aggregate, "ASSIGNED");
      requireCurrentAssignee(aggregate, actor);
      return;

    case "request_handoff":
      requireStatus(aggregate, "IN_PROGRESS");
      requireCurrentAssignee(aggregate, actor);
      return;

    case "accept_handoff":
      requireStatus(aggregate, "HANDOFF_PENDING");
      if (
        !aggregate.handoffTargetId ||
        aggregate.handoffTargetId !== actor
      ) {
        throw new InvalidTransitionError(
          "Only the requested handoff target may accept",
        );
      }
      if (!aggregate.assigneeId) {
        throw new InvalidTransitionError(
          "Handoff cannot proceed without an outgoing assignee",
        );
      }
      return;

    case "complete":
      requireStatus(aggregate, "IN_PROGRESS");
      requireCurrentAssignee(aggregate, actor);
      return;

    case "close":
      requireStatus(aggregate, "COMPLETED");
      return;

    case "reopen":
      requireStatus(
        aggregate,
        "COMPLETED",
        "CLOSED",
      );
      return;
  }
}

export function canCaseCommand(
  aggregate: CaseAggregate,
  actorId: string,
  type: CaseCommandType,
): boolean {
  try {
    assertCaseCommandAvailable(
      aggregate,
      actorId,
      type,
    );
    return true;
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return false;
    }
    throw error;
  }
}

export function createCase(input: NewCaseInput): {
  aggregate: CaseAggregate;
  event: CaseCreatedEvent;
} {
  const caseId = requireText(input.id, "case id", 128);
  const tenantId = requireText(input.tenantId, "tenant id", 128);
  const subjectId = requireText(input.subjectId, "subject id", 128);
  const sourceAdapter = requireText(input.sourceAdapter, "source adapter", 128);
  const sourceSignalId = requireText(input.sourceSignalId, "source signal id", 128);
  requireEnum(input.sourceType, SIGNAL_TYPES, "source type");
  requireEnum(input.priority, CASE_PRIORITIES, "priority");
  requireEventTime(input.createdAt);

  const event: CaseCreatedEvent = {
    type: "case_created",
    sequence: 1,
    at: input.createdAt,
    actorId: null,
    data: {
      caseId,
      tenantId,
      subjectId,
      sourceType: input.sourceType,
      sourceAdapter,
      sourceSignalId,
      priority: input.priority,
    },
  };

  return { aggregate: applyEvent(null, event), event };
}

export function executeCommand(
  aggregate: CaseAggregate,
  expectedVersion: number,
  command: CaseCommand,
  at: string,
): { aggregate: CaseAggregate; event: CaseEvent } {
  if (aggregate.version !== expectedVersion) {
    throw new CaseConflictError(expectedVersion, aggregate.version);
  }

  const actorId = requireText(command.actorId, "actor id", 128);
  assertCaseCommandAvailable(
    aggregate,
    actorId,
    command.type,
  );
  const sequence = aggregate.version + 1;
  let event: CaseEvent;

  switch (command.type) {
    case "set_priority":
      requireEnum(command.priority, CASE_PRIORITIES, "priority");
      if (command.priority === aggregate.priority) {
        throw new InvalidTransitionError(
          "Priority change must select a different priority",
        );
      }
      event = {
        type: "priority_changed",
        sequence,
        at,
        actorId,
        data: {
          previousPriority: aggregate.priority,
          priority: command.priority,
        },
      };
      break;

    case "acknowledge":
      event = {
        type: "acknowledged",
        sequence,
        at,
        actorId,
        data: {},
      };
      break;

    case "assign":
      event = {
        type: "assigned",
        sequence,
        at,
        actorId,
        data: { assigneeId: requireText(command.assigneeId, "assignee id", 128) },
      };
      break;

    case "start_action":
      event = {
        type: "action_started",
        sequence,
        at,
        actorId,
        data: {},
      };
      break;

    case "request_handoff":
      if (requireText(command.targetAssigneeId, "handoff target", 128) === actorId) {
        throw new InvalidTransitionError(
          "Handoff target must differ from current assignee",
        );
      }
      event = {
        type: "handoff_requested",
        sequence,
        at,
        actorId,
        data: { targetAssigneeId: command.targetAssigneeId.trim() },
      };
      break;

    case "accept_handoff":
      event = {
        type: "handoff_accepted",
        sequence,
        at,
        actorId,
        data: {
          previousAssigneeId:
            aggregate.assigneeId!,
        },
      };
      break;

    case "complete":
      requireEnum(command.outcome, COMPLETION_OUTCOMES, "completion outcome");
      event = {
        type: "completed",
        sequence,
        at,
        actorId,
        data: {
          outcome: command.outcome,
          summary: requireText(command.summary, "completion summary", 4000),
          evidence: requireEvidence(command.evidence),
        },
      };
      break;

    case "close":
      event = {
        type: "closed",
        sequence,
        at,
        actorId,
        data: {},
      };
      break;

    case "reopen":
      event = {
        type: "reopened",
        sequence,
        at,
        actorId,
        data: { reason: requireText(command.reason, "reopen reason", 1000) },
      };
      break;

    default:
      throw new InvalidTransitionError("Unsupported Case command type");
  }

  return { aggregate: applyEvent(aggregate, event), event };
}

export function applyEvent(
  aggregate: CaseAggregate | null,
  event: CaseEvent,
): CaseAggregate {
  // Replayed records are treated as untrusted even if TypeScript types match.
  if (!event || typeof event !== "object" ||
    !Number.isSafeInteger(event.sequence) || event.sequence < 1 ||
    !event.data || typeof event.data !== "object" || Array.isArray(event.data)) {
    throw new InvalidTransitionError("Malformed Case event");
  }
  const eventTime = requireEventTime(event.at);
  if (event.type === "case_created") {
    if (aggregate) {
      throw new InvalidTransitionError(
        "case_created must be the first event",
      );
    }
    if (event.sequence !== 1) {
      throw new InvalidTransitionError(
        "case_created must have sequence 1",
      );
    }
    if (event.actorId !== null) {
      throw new InvalidTransitionError("Case creation must be a source event");
    }
    requireText(event.data.caseId, "case id", 128);
    requireText(event.data.tenantId, "tenant id", 128);
    requireText(event.data.subjectId, "subject id", 128);
    requireText(event.data.sourceAdapter, "source adapter", 128);
    requireText(event.data.sourceSignalId, "source signal id", 128);
    requireEnum(event.data.sourceType, SIGNAL_TYPES, "source type");
    requireEnum(event.data.priority, CASE_PRIORITIES, "priority");

    return {
      id: event.data.caseId,
      tenantId: event.data.tenantId,
      subjectId: event.data.subjectId,
      sourceType: event.data.sourceType,
      sourceAdapter: event.data.sourceAdapter,
      sourceSignalId: event.data.sourceSignalId,
      priority: event.data.priority,
      status: "NEW",
      version: 1,
      assigneeId: null,
      handoffTargetId: null,
      createdAt: event.at,
      acknowledgedAt: null,
      assignedAt: null,
      firstActionAt: null,
      completedAt: null,
      closedAt: null,
      reopenedCount: 0,
      completion: null,
    };
  }

  if (!aggregate) {
    throw new InvalidTransitionError(
      "case_created must precede all other events",
    );
  }
  if (event.sequence !== aggregate.version + 1) {
    throw new InvalidTransitionError(
      `Event sequence gap: expected ${aggregate.version + 1}, received ${event.sequence}`,
    );
  }
  requireText(event.actorId, "event actor id", 128);
  if (eventTime < requireEventTime(aggregate.createdAt)) {
    throw new InvalidTransitionError("Event predates Case creation");
  }

  const next: CaseAggregate = {
    ...aggregate,
    version: event.sequence,
  };

  switch (event.type) {
    case "priority_changed":
      requireEnum(event.data.priority, CASE_PRIORITIES, "priority");
      requireEnum(event.data.previousPriority, CASE_PRIORITIES, "previous priority");
      requireStatus(
        aggregate,
        "NEW",
        "ACKNOWLEDGED",
        "ASSIGNED",
        "IN_PROGRESS",
        "HANDOFF_PENDING",
      );
      if (event.data.previousPriority !== aggregate.priority) {
        throw new InvalidTransitionError(
          "Priority change previous value does not match aggregate",
        );
      }
      if (event.data.priority === aggregate.priority) {
        throw new InvalidTransitionError(
          "Priority change must select a different priority",
        );
      }
      return {
        ...next,
        priority: event.data.priority,
      };

    case "acknowledged":
      requireStatus(aggregate, "NEW");
      return {
        ...next,
        status: "ACKNOWLEDGED",
        acknowledgedAt: event.at,
      };

    case "assigned":
      requireStatus(aggregate, "ACKNOWLEDGED");
      requireText(event.data.assigneeId, "assigned actor id", 128);
      return {
        ...next,
        status: "ASSIGNED",
        assigneeId: event.data.assigneeId,
        assignedAt: event.at,
      };

    case "action_started":
      requireStatus(aggregate, "ASSIGNED");
      requireCurrentAssignee(aggregate, event.actorId);
      return {
        ...next,
        status: "IN_PROGRESS",
        firstActionAt: aggregate.firstActionAt ?? event.at,
      };

    case "handoff_requested":
      requireStatus(aggregate, "IN_PROGRESS");
      requireCurrentAssignee(aggregate, event.actorId);
      requireText(event.data.targetAssigneeId, "handoff target", 128);
      if (event.data.targetAssigneeId === aggregate.assigneeId) {
        throw new InvalidTransitionError("Handoff cannot target current owner");
      }
      return {
        ...next,
        status: "HANDOFF_PENDING",
        handoffTargetId: event.data.targetAssigneeId,
      };

    case "handoff_accepted":
      requireStatus(aggregate, "HANDOFF_PENDING");
      if (aggregate.handoffTargetId !== event.actorId) {
        throw new InvalidTransitionError(
          "Handoff acceptance actor does not match target",
        );
      }
      if (event.data.previousAssigneeId !== aggregate.assigneeId) {
        throw new InvalidTransitionError("Handoff previous owner mismatch");
      }
      return {
        ...next,
        status: "IN_PROGRESS",
        assigneeId: event.actorId,
        handoffTargetId: null,
      };

    case "completed":
      requireStatus(aggregate, "IN_PROGRESS");
      requireCurrentAssignee(aggregate, event.actorId);
      requireEnum(event.data.outcome, COMPLETION_OUTCOMES, "completion outcome");
      requireText(event.data.summary, "completion summary", 4000);
      const evidence = requireEvidence(event.data.evidence);
      return {
        ...next,
        status: "COMPLETED",
        completedAt: event.at,
        completion: {
          outcome: event.data.outcome,
          summary: event.data.summary,
          evidence,
          completedBy: event.actorId,
          completedAt: event.at,
        },
      };

    case "closed":
      requireStatus(aggregate, "COMPLETED");
      return {
        ...next,
        status: "CLOSED",
        closedAt: event.at,
      };

    case "reopened":
      requireStatus(aggregate, "COMPLETED", "CLOSED");
      requireText(event.data.reason, "reopen reason", 1000);
      return {
        ...next,
        status: "IN_PROGRESS",
        assigneeId: event.actorId,
        handoffTargetId: null,
        completedAt: null,
        closedAt: null,
        reopenedCount: aggregate.reopenedCount + 1,
        completion: null,
      };

    default:
      throw new InvalidTransitionError("Unsupported Case event type");
  }
}

export function replayCase(events: readonly CaseEvent[]): CaseAggregate {
  if (events.length === 0) {
    throw new InvalidTransitionError(
      "Cannot replay a case without events",
    );
  }

  return events.reduce<CaseAggregate | null>(
    (aggregate, event) => applyEvent(aggregate, event),
    null,
  ) as CaseAggregate;
}
