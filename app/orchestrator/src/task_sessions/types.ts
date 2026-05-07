import type { TaskFollowupPolicyMeta } from "./task_followup_policy.js";

export type TaskFollowupInput = {
  task_session_id: string;
  text: string;
  event_ids: string[];
  idempotency_key: string;
  policy?: TaskFollowupPolicyMeta;
};

export type TaskSessionController = {
  listSessions?: () => Promise<unknown[]> | unknown[];
  getSession?: (taskSessionId: string) => Promise<unknown | undefined> | unknown | undefined;
  sendFollowupMessage(input: TaskFollowupInput): Promise<unknown> | unknown;
  bindTaskSession?: (input: {
    task_session_id: string;
    task_id: string;
  }) => Promise<unknown> | unknown;
};
