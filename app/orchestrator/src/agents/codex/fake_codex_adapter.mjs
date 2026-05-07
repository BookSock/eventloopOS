import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isoNow, makeAction, makeEvidenceRef, makeRawRef } from "../local_contracts.mjs";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export async function parseFakeCodexJsonStreamFile(filePath) {
  const resolvedPath = resolveFixturePath(filePath);
  const body = await readFile(resolvedPath, "utf8");
  return parseFakeCodexJsonStream(body, { sourceUri: filePath });
}

export function parseFakeCodexJsonStream(body, { sourceUri = "memory://fake-codex-stream" } = {}) {
  const trimmed = body.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("fake codex stream array expected");
    return parsed.map((event, index) => normalizeStreamEvent(event, index, sourceUri));
  }

  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => normalizeStreamEvent(JSON.parse(line), index, sourceUri));
}

export function buildAgentRunFromFakeCodexStream(events, options = {}) {
  const clock = options.clock ?? (() => new Date());
  const now = isoNow(clock);
  const first = events[0] ?? {};
  const runId = options.runId ?? first.run_id ?? "run_fake_codex";
  const taskId = options.taskId ?? first.task_id;
  const outputRef = makeRawRef({
    id: `raw_${runId}_stream`,
    uri: options.sourceUri ?? first.source_uri ?? "memory://fake-codex-stream",
  });
  const state = reduceRunState(events);

  return {
    id: runId,
    provider: "fake",
    task_id: taskId,
    thread_id: options.threadId ?? first.thread_id,
    status: state.status,
    started_at: state.started_at,
    updated_at: now,
    completed_at: state.completed_at,
    blocked_reason: state.blocked_reason,
    risk_tags: state.risk_tags,
    evidence: [
      makeEvidenceRef({
        id: `ev_${runId}_stream`,
        title: "Fake Codex JSON stream",
        ref: outputRef.uri,
        captured_at: now,
      }),
    ],
    output_refs: [outputRef],
    resume_actions: buildResumeActions(runId, state),
  };
}

export function buildReviewPacketFromFakeCodexStream(events, run, options = {}) {
  const blockedEvent = [...events].reverse().find(isApprovalOrBlockedEvent);
  if (!blockedEvent) return undefined;

  const clock = options.clock ?? (() => new Date());
  const now = isoNow(clock);
  const runId = run.id;
  const riskTags = uniqueStrings([
    ...(run.risk_tags ?? []),
    ...(blockedEvent.risk_tags ?? []),
    ...(blockedEvent.riskTags ?? []),
  ]);
  const summary = blockedEvent.summary ?? blockedEvent.message ?? "Fake Codex run is waiting for approval.";
  const decisionNeeded =
    blockedEvent.decision_needed ??
    blockedEvent.decisionNeeded ??
    "Approve resume action or provide followup instructions.";

  return {
    id: options.packetId ?? blockedEvent.packet_id ?? `pkt_${runId}_approval`,
    task_id: run.task_id,
    agent_run_id: runId,
    title: blockedEvent.title ?? "Fake Codex approval needed",
    summary,
    decision_needed: decisionNeeded,
    risk_level: blockedEvent.risk_level ?? inferRiskLevel(riskTags, run.evidence),
    confidence: blockedEvent.confidence ?? "medium",
    risk_tags: riskTags,
    evidence: [
      ...run.evidence,
      makeEvidenceRef({
        id: `ev_${runId}_approval`,
        title: "Approval request",
        ref: `${run.output_refs[0]?.uri ?? "memory://fake-codex-stream"}#${blockedEvent.index}`,
        captured_at: now,
      }),
    ],
    context: blockedEvent.context ?? [],
    recommended_action: makeAction({
      id: `act_${runId}_resume`,
      type: "resume_agent",
      label: "Resume fake Codex run",
      payload: {
        agent_run_id: runId,
        stream_event_index: blockedEvent.index,
      },
      requires_approval: true,
    }),
    alternate_actions: [
      makeAction({
        id: `act_${runId}_followup`,
        type: "resume_agent",
        label: "Send followup instead",
        payload: {
          agent_run_id: runId,
        },
        requires_approval: false,
      }),
    ],
    created_at: now,
    updated_at: now,
  };
}

export async function runFakeCodexFixture(filePath, options = {}) {
  const events = await parseFakeCodexJsonStreamFile(filePath);
  const run = buildAgentRunFromFakeCodexStream(events, {
    ...options,
    sourceUri: filePath,
  });
  const reviewPacket = buildReviewPacketFromFakeCodexStream(events, run, options);
  return { events, run, reviewPacket };
}

export function resumeFakeCodexRun(run, action, options = {}) {
  if (TERMINAL_STATUSES.has(run.status)) {
    return {
      ...run,
      updated_at: isoNow(options.clock ?? (() => new Date())),
      resume_actions: [],
    };
  }

  const now = isoNow(options.clock ?? (() => new Date()));
  return {
    ...run,
    status: "running",
    blocked_reason: undefined,
    updated_at: now,
    evidence: [
      ...(run.evidence ?? []),
      makeEvidenceRef({
        id: `ev_${run.id}_resume_${action?.id ?? "manual"}`,
        title: "Fake resume action accepted",
        ref: action?.id ?? "manual",
        captured_at: now,
      }),
    ],
    resume_actions: [],
  };
}

function normalizeStreamEvent(event, index, sourceUri) {
  if (!event || typeof event !== "object") {
    throw new Error(`fake codex stream event ${index} must be object`);
  }

  const type = event.type ?? event.event ?? event.status;
  if (!type) throw new Error(`fake codex stream event ${index} missing type`);

  return {
    ...event,
    type,
    index,
    source_uri: sourceUri,
  };
}

function resolveFixturePath(filePath) {
  if (!filePath.startsWith("tests/")) return filePath;
  return resolve(process.cwd(), "../..", filePath);
}

function reduceRunState(events) {
  const state = {
    status: "queued",
    started_at: undefined,
    completed_at: undefined,
    blocked_reason: undefined,
    risk_tags: [],
  };

  for (const event of events) {
    const type = event.type;
    if (type === "started" || type === "running" || type === "output") {
      state.status = "running";
      state.started_at ||= event.timestamp ?? event.occurred_at;
    }

    if (isApprovalOrBlockedEvent(event)) {
      state.status = event.status === "blocked" || type === "blocked" ? "blocked" : "waiting_approval";
      state.blocked_reason =
        event.blocked_reason ?? event.reason ?? event.decision_needed ?? event.message ?? "approval needed";
      state.risk_tags = uniqueStrings([
        ...state.risk_tags,
        ...(event.risk_tags ?? []),
        ...(event.riskTags ?? []),
      ]);
    }

    if (type === "completed" || type === "succeeded") {
      state.status = "completed";
      state.completed_at = event.timestamp ?? event.occurred_at;
      state.blocked_reason = undefined;
    }

    if (type === "failed" || type === "error") {
      state.status = "failed";
      state.completed_at = event.timestamp ?? event.occurred_at;
      state.blocked_reason = event.error ?? event.message ?? "fake codex run failed";
    }
  }

  return state;
}

function buildResumeActions(runId, state) {
  if (state.status !== "waiting_approval" && state.status !== "blocked") return [];

  return [
    makeAction({
      id: `act_${runId}_resume`,
      type: "resume_agent",
      label: "Resume fake Codex run",
      payload: { agent_run_id: runId },
      requires_approval: true,
    }),
  ];
}

function isApprovalOrBlockedEvent(event) {
  return (
    event.type === "approval_request" ||
    event.type === "waiting_approval" ||
    event.type === "blocked" ||
    event.status === "waiting_approval" ||
    event.status === "blocked"
  );
}

function inferRiskLevel(riskTags, evidence) {
  if (riskTags.includes("critical")) return "critical";
  if (riskTags.includes("external_send") || riskTags.includes("credential") || riskTags.includes("prod")) {
    return "high";
  }
  if (!evidence || evidence.length === 0) return "medium";
  return riskTags.length > 0 ? "medium" : "low";
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

export function fixtureName(filePath) {
  return basename(filePath).replace(/\.[^.]+$/, "");
}
