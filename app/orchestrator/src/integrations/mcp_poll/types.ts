export type McpEventActor = {
  id: string;
  type: "human" | "agent" | "system";
  name?: string;
};

export type McpEvent = {
  id: string;
  source: string;
  source_id: string;
  idempotency_key: string;
  occurred_at: string;
  received_at: string;
  actor: McpEventActor;
  project_hint?: string;
  task_hint?: string;
  type: string;
  title: string;
  summary: string;
  raw_ref: {
    id: string;
    uri: string;
    media_type: string;
  };
  links: Array<{
    label: string;
    url: string;
  }>;
  resources: Array<Record<string, unknown>>;
};

export type McpRiskPolicy = {
  readOnly: boolean;
  allowWriteTools: boolean;
  maxRiskLevel: "low" | "medium" | "high" | "critical";
  untrustedTextFields: string[];
};

export type McpPollSourceConfig = {
  id: string;
  server: {
    name: string;
    command: string;
    args: string[];
    envAllowlist: string[];
    stderrLogPath: string;
  };
  poll: {
    tool: string;
    args: Record<string, unknown>;
    timeoutMs: number;
  };
  cursor: {
    strategy: "field" | "hash";
    field?: string;
    initial?: string;
    dedupeWindow: number;
  };
  eventMapper: "slack_message_to_event" | "github_update_to_event";
  riskPolicy: McpRiskPolicy;
};

export type McpPollItem = Record<string, unknown>;

export type McpPollResult = {
  items: McpPollItem[];
  nextCursor?: string;
};

export type McpCursorState = {
  cursor?: string;
  seen: Set<string>;
};
