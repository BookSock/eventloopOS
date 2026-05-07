import type { EvidenceRef } from "../contracts.js";
import type { AutonomyGrant, AutonomySurface } from "../hooks/autonomy-grants.js";

export type TaskFollowupPolicyMeta = {
  hook: "before_task_message";
  surface: AutonomySurface;
  untrusted_source_text: string;
  evidence: EvidenceRef[];
  approval_decision_id?: string;
  grants?: AutonomyGrant[];
  scope_kind?: AutonomyGrant["scope_kind"];
  scope_id?: string;
};
