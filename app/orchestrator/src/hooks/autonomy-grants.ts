export type AutonomySurface =
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

export type AutonomyLevel = "deny" | "ask" | "allow";

export type AutonomyGrant = {
  id: string;
  scope_kind: "source" | "task" | "agent_session" | "workspace_backend";
  scope_id: string;
  surface: AutonomySurface;
  level: AutonomyLevel;
  expires_at?: string;
  created_at: string;
};

export type EvaluateAutonomyInput = {
  surface: AutonomySurface;
  scope_kind?: AutonomyGrant["scope_kind"];
  scope_id?: string;
  grants?: AutonomyGrant[];
  now?: Date;
};

const DEFAULT_SURFACE_LEVELS: Record<AutonomySurface, AutonomyLevel> = {
  source_read: "allow",
  context_read: "allow",
  workspace_restore: "ask",
  task_message: "ask",
  local_write: "ask",
  external_draft: "ask",
  external_send: "ask",
  prod_action: "deny",
  money_action: "deny",
  credential_action: "deny",
};

export function evaluateAutonomyGrant(input: EvaluateAutonomyInput): AutonomyLevel {
  const now = input.now ?? new Date();
  const matchingGrant = input.grants
    ?.filter((grant) => grant.surface === input.surface)
    .filter((grant) => !grant.expires_at || Date.parse(grant.expires_at) > now.getTime())
    .find((grant) => {
      if (input.scope_kind && grant.scope_kind !== input.scope_kind) {
        return false;
      }

      if (input.scope_id && grant.scope_id !== input.scope_id) {
        return false;
      }

      return true;
    });

  return matchingGrant?.level ?? DEFAULT_SURFACE_LEVELS[input.surface];
}

