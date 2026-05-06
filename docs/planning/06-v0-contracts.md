# V0 Contracts

Goal: make modules independent. Contracts first, implementations second.

## Package

Own in `app/shared`.

Expose:

- TypeScript types.
- Zod schemas.
- JSON Schema exports.
- Fixture validator CLI.

Do not expose DB models as public contracts. Public contracts are API/event/action shapes.

## IDs

Use stable string IDs:

```text
evt_...
task_...
ctx_...
run_...
pkt_...
qit_...
act_...
dec_...
```

Every external event gets `source_id` + `idempotency_key`.

## Core Types

### Event

```ts
type Event = {
  id: string;
  source: "slack" | "github" | "notion" | "browser" | "agent" | "manual" | "voice" | "mcp_poll" | "local";
  source_id: string;
  idempotency_key: string;
  occurred_at: string;
  received_at: string;
  actor?: Actor;
  project_hint?: string;
  task_hint?: string;
  type: string;
  title: string;
  summary?: string;
  raw_ref: RawRef;
  links: LinkRef[];
  resources: ContextResource[];
};
```

Rules:

- `raw_ref` points to stored raw payload.
- `links` are user-openable.
- `resources` are system-restorable.
- Adapter emits `Event`; adapter does not create queue item directly.

### Task

```ts
type Task = {
  id: string;
  title: string;
  status: "active" | "blocked" | "waiting" | "done" | "archived";
  project?: string;
  owner?: Actor;
  priority: number;
  importance: number;
  created_at: string;
  updated_at: string;
  resources: ContextResource[];
  source_links: LinkRef[];
};
```

Rules:

- Task is durable work unit.
- Events can attach to existing task by explicit link, project hint, URL, branch, PR, Slack thread, task doc.
- Task may exist before any agent run.

### ContextResource

```ts
type ContextResource =
  | BrowserTabResource
  | UrlResource
  | FileResource
  | AppWindowResource
  | TerminalResource
  | SlackThreadResource
  | GitHubResource
  | AgentThreadResource
  | VoiceCommandResource
  | TaskSessionResource
  | McpSourceResource;
```

Required base:

```ts
type ContextResourceBase = {
  id: string;
  kind: string;
  title: string;
  url?: string;
  source?: string;
  captured_at?: string;
  restore_confidence: "high" | "medium" | "low";
};
```

Rules:

- Resource must be openable or explain why not.
- Browser tab resources can include `window_id`, `tab_id`, `scroll_y`, `text_quote`, `selector_hint`.
- macOS window resources can include `bundle_id`, `pid`, `window_id`, `frame`.

### AgentRun

```ts
type AgentRun = {
  id: string;
  provider: "codex" | "claude" | "openai" | "manual" | "fake";
  task_id?: string;
  thread_id?: string;
  status: "queued" | "running" | "blocked" | "waiting_approval" | "completed" | "failed" | "cancelled";
  started_at?: string;
  updated_at: string;
  completed_at?: string;
  blocked_reason?: string;
  risk_tags: RiskTag[];
  evidence: EvidenceRef[];
  output_refs: RawRef[];
  resume_actions: Action[];
};
```

Rules:

- Agent adapter owns provider-specific parsing.
- Orchestrator only sees normalized run state.
- `waiting_approval` always creates or updates review packet.

### TaskSession

```ts
type TaskSession = {
  id: string;
  task_id?: string;
  provider: "codex" | "claude" | "terminal" | "fake";
  native_thread_id?: string;
  terminal_ref?: string;
  status: "idle" | "running" | "blocked" | "stopped" | "lost";
  supports: {
    steer: boolean;
    followup: boolean;
    collect: boolean;
    interrupt: boolean;
    compact: boolean;
  };
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};
```

Rules:

- structured app-server/native thread beats terminal paste.
- terminal send is fallback and must be audited.
- no send without stable task/session match.

### TaskMessage

```ts
type TaskMessage = {
  id: string;
  task_session_id: string;
  mode: "steer" | "followup" | "collect" | "steer_backlog" | "interrupt";
  text: string;
  event_ids: string[];
  idempotency_key: string;
  sent_at?: string;
  status: "queued" | "sent" | "failed" | "blocked";
  evidence: EvidenceRef[];
};
```

Rules:

- new info routes through task message, not raw terminal text.
- mode records why message was delivered now/later.
- failed send can create review packet.

### ReviewPacket

```ts
type ReviewPacket = {
  id: string;
  task_id?: string;
  agent_run_id?: string;
  title: string;
  summary: string;
  decision_needed: string;
  risk_level: "low" | "medium" | "high" | "critical";
  confidence: "low" | "medium" | "high";
  risk_tags: RiskTag[];
  evidence: EvidenceRef[];
  context: ContextResource[];
  recommended_action: Action;
  alternate_actions: Action[];
  created_at: string;
  updated_at: string;
};
```

Rules:

- Packet must answer: what changed, why now, what decision, what happens if approved.
- Evidence required. No evidence -> risk at least `medium`.
- External send/delete/prod/money/legal/credential actions -> approval required.

### QueueItem

```ts
type QueueItem = {
  id: string;
  review_packet_id: string;
  task_id?: string;
  state: "ready" | "leased" | "deferred" | "done" | "dead";
  priority_score: number;
  priority_reasons: string[];
  due_at?: string;
  lease_owner?: string;
  lease_expires_at?: string;
  created_at: string;
  updated_at: string;
};
```

Rules:

- Queue rank deterministic.
- Lease prevents two agents/users handling same item.
- Done item keeps audit trail.

### RouteDecision

```ts
type RouteDecision = {
  id: string;
  event_id: string;
  action:
    | "ignore"
    | "store_only"
    | "attach_to_task"
    | "start_agent_thread"
    | "inject_into_agent_thread"
    | "create_review_packet"
    | "ask_human_now"
    | "defer_until_context";
  target_task_id?: string;
  target_task_session_id?: string;
  confidence: "low" | "medium" | "high";
  evidence: EvidenceRef[];
  created_at: string;
};
```

Rules:

- low evidence cannot silently start external work.
- uncertain routing creates review packet.

### OwnershipLock

```ts
type OwnershipLock = {
  id: string;
  resource_key: string;
  owner_task_id?: string;
  owner_agent_run_id?: string;
  lock_kind: "route" | "draft" | "send" | "workspace" | "poll";
  lease_expires_at?: string;
  evidence: EvidenceRef[];
  created_at: string;
  updated_at: string;
};
```

Rules:

- external send requires lock or human approval.
- lock conflict routes to queue, not duplicate agent.

### HookDecision

```ts
type HookDecision = {
  hook: string;
  decision: "allow" | "block" | "rewrite" | "require_approval";
  reason?: string;
  rewritten_payload?: Record<string, unknown>;
  evidence: EvidenceRef[];
};
```

Rules:

- hook decisions have timeout.
- block/approval decisions audited.

### EvidenceReceipt

```ts
type EvidenceReceipt = {
  id: string;
  action_type:
    | "source_poll"
    | "event_normalize"
    | "task_message"
    | "workspace_restore"
    | "test_run"
    | "browser_capture"
    | "external_draft"
    | "external_send";
  actor_id: string;
  input_hash: string;
  output_hash?: string;
  previous_receipt_hash?: string;
  artifact_refs: RawRef[];
  created_at: string;
};
```

Rules:

- agent claim needs receipt when claim is about tool/test/source/action.
- receipt can be simple hash chain v0.
- receipts back review packet evidence.

### Procedure

```ts
type Procedure = {
  id: string;
  name: string;
  trigger_types: string[];
  steps: ProcedureStep[];
  approval_required_for: string[];
  created_at: string;
  updated_at: string;
};

type ProcedureRun = {
  id: string;
  procedure_id: string;
  task_id?: string;
  state: "running" | "waiting_human" | "resumed" | "completed" | "failed" | "cancelled";
  current_step_id: string;
  resume_pointer?: Record<string, unknown>;
  receipt_ids: string[];
  created_at: string;
  updated_at: string;
};
```

Rules:

- repeated workflows use procedure skeleton.
- queue item from procedure must include resume pointer.
- agents fill content; control flow stays inspectable.

### AutonomyGrant

```ts
type AutonomyGrant = {
  id: string;
  scope_kind: "source" | "task" | "agent_session" | "workspace_backend";
  scope_id: string;
  surface:
    | "source_read"
    | "context_read"
    | "workspace_restore"
    | "task_message"
    | "local_write"
    | "external_draft"
    | "external_send"
    | "prod_action"
    | "money_action"
    | "credential_action";
  level: "deny" | "ask" | "allow";
  expires_at?: string;
  created_at: string;
};
```

Rules:

- approval policy checks grants by surface.
- grants can be per task/source/session.
- default high-risk external/prod/money/credential is `ask` or `deny`.

### Action

```ts
type Action = {
  id: string;
  type: "approve" | "reject" | "edit" | "defer" | "open_context" | "resume_agent" | "mark_done";
  label: string;
  requires_confirmation: boolean;
  side_effect: "none" | "local" | "external" | "production" | "sensitive";
  payload: Record<string, unknown>;
};
```

Rules:

- UI can render any action from contract alone.
- Orchestrator validates action before execution.
- Sensitive action cannot execute from browser extension directly.

### Decision

```ts
type Decision = {
  id: string;
  review_packet_id: string;
  queue_item_id: string;
  action_id: string;
  actor: Actor;
  note?: string;
  decided_at: string;
  result_refs: RawRef[];
};
```

Rules:

- Every human action creates decision record.
- Agent resume points back to decision.

## API V0

Orchestrator exposes local HTTP first.

```text
GET  /health
GET  /queue/next
GET  /queue
GET  /review-packets/:id
POST /events
POST /context/capture
GET  /workspace/status
POST /workspace/capture
POST /workspace/restore-plan
POST /workspace/restore
POST /actions/:id/execute
POST /agent-runs/:id/resume
POST /router/route
GET  /agent-threads
GET  /mcp-sources
POST /mcp-sources/:id/poll
POST /mcp-sources/:id/poll-and-route
GET  /task-sessions
GET  /task-sessions/:id
POST /task-sessions/:id/steer
POST /task-sessions/:id/followup
POST /ownership-locks
POST /hooks/evaluate
POST /receipts
GET  /sources/health
```

`GET /workspace/status` and `POST /workspace/restore-plan` return `execute_supported`.
Default is `false`. `POST /workspace/restore` is disabled unless
`ORCHESTRATOR_WORKSPACE_EXECUTE=enabled`; when enabled, it still requires
`confirm_execute: true` and an `idempotency-key` header. It recomputes the
plan from snapshot/current windows before execution instead of accepting raw
commands from a client.

Later:

```text
WS /events
WS /queue
```

## Native Messaging V0

Browser extension -> native host:

```ts
type BrowserMessage =
  | { type: "capture_active_tab"; request_id: string }
  | { type: "tab_changed"; request_id: string; resource: ContextResource }
  | { type: "restore_result"; request_id: string; ok: boolean; error?: string };
```

Native host -> browser extension:

```ts
type BrowserCommand =
  | { type: "restore_tab"; request_id: string; resource: ContextResource }
  | { type: "capture_active_tab"; request_id: string };
```

Rules:

- Every message has `request_id`.
- Every command gets result.
- Failed restore creates evidence, not silent failure.

## Contract Tests

Required fixtures:

- Raw Slack event -> normalized `Event`.
- Raw GitHub MCP/webhook event -> normalized `Event`.
- Raw MCP poll result -> normalized `Event`.
- Fake Codex stream -> `AgentRun` + `ReviewPacket`.
- Browser capture -> `ContextResource`.
- Review packet -> `QueueItem`.

Command:

```bash
make test:contracts
```
