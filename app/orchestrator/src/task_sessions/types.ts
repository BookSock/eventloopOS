export type TaskSessionController = {
  listSessions?: () => Promise<unknown[]> | unknown[];
  getSession?: (taskSessionId: string) => Promise<unknown | undefined> | unknown | undefined;
  sendFollowupMessage(input: {
    task_session_id: string;
    text: string;
    event_ids: string[];
    idempotency_key: string;
  }): Promise<unknown> | unknown;
};
