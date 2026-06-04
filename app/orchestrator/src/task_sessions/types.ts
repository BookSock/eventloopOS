import type { TaskFollowupPolicyMeta } from "./task_followup_policy.js";

export type TaskRuntimeProvider = "codex" | "claude" | "fake" | "terminal" | "composite" | string;
export type TaskRuntimeSessionStatus = "idle" | "running" | "blocked" | "stopped" | "lost" | string;
export type TaskRuntimeMessageStatus = "sent" | "failed" | "blocked";

export type TaskRuntimeCapabilities = {
  steer?: boolean;
  followup?: boolean;
  collect?: boolean;
  interrupt?: boolean;
  compact?: boolean;
};

export type TaskRuntimeEvidenceRef = {
  id: string;
  kind: string;
  title: string;
  ref: string;
  captured_at: string;
};

export type TaskRuntimeSession = Record<string, unknown> & {
  id?: string;
  task_id?: string;
  provider?: TaskRuntimeProvider;
  status?: TaskRuntimeSessionStatus;
  supports?: TaskRuntimeCapabilities;
  last_seen_at?: string;
  created_at?: string;
  updated_at?: string;
  pid?: number;
  agent_pid?: number;
  terminal_pid?: number;
  root_pid?: number;
  pids?: number[];
};

export type TaskRuntimeMessage = Record<string, unknown> & {
  id?: string;
  task_session_id?: string;
  mode?: "followup" | string;
  event_ids?: string[];
  idempotency_key?: string;
  status?: TaskRuntimeMessageStatus | string;
  text?: string;
  sent_at?: string;
  error?: string;
  evidence?: TaskRuntimeEvidenceRef[];
};

export type TaskRuntimeBinding = Record<string, unknown> & {
  ok: boolean;
  task_session_id: string;
  task_id: string;
  session?: TaskRuntimeSession;
  error?: string;
};

export type TaskRuntimeStart = Record<string, unknown> & {
  ok: boolean;
  task_session_id?: string;
  task_id: string;
  session?: TaskRuntimeSession;
  message?: TaskRuntimeMessage;
  error?: string;
};

export type TaskRuntimeError = {
  code: string;
  message: string;
  provider?: TaskRuntimeProvider;
  task_session_id?: string;
  retryable?: boolean;
};

export type TaskFollowupInput = {
  task_session_id: string;
  text: string;
  event_ids: string[];
  idempotency_key: string;
  policy?: TaskFollowupPolicyMeta;
};

export type TaskSessionController = {
  listSessions?: () => Promise<TaskRuntimeSession[]> | TaskRuntimeSession[];
  getSession?: (taskSessionId: string) => Promise<TaskRuntimeSession | undefined> | TaskRuntimeSession | undefined;
  startTaskSession?: (input: {
    task_id: string;
    prompt: string;
    cwd?: string;
    model?: string;
    idempotency_key: string;
  }) => Promise<TaskRuntimeStart> | TaskRuntimeStart;
  sendFollowupMessage(input: TaskFollowupInput): Promise<TaskRuntimeMessage> | TaskRuntimeMessage;
  bindTaskSession?: (input: {
    task_session_id: string;
    task_id: string;
    terminal_ref?: string;
  }) => Promise<TaskRuntimeBinding> | TaskRuntimeBinding;
};
