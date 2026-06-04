export type TaskSessionPidFields = {
  pid?: number;
  agent_pid?: number;
  terminal_pid?: number;
  root_pid?: number;
  pids?: number[];
};

export function normalizeTaskSessionPidFields(input: TaskSessionPidFields): TaskSessionPidFields {
  const pid = positiveInteger(input.pid);
  const agentPid = positiveInteger(input.agent_pid);
  const terminalPid = positiveInteger(input.terminal_pid);
  const rootPid = positiveInteger(input.root_pid) ?? terminalPid ?? pid ?? agentPid;
  const pids = uniquePositiveIntegers([
    rootPid,
    terminalPid,
    pid,
    agentPid,
    ...(Array.isArray(input.pids) ? input.pids : []),
  ]);

  return {
    ...(pid !== undefined ? { pid } : {}),
    ...(agentPid !== undefined ? { agent_pid: agentPid } : {}),
    ...(terminalPid !== undefined ? { terminal_pid: terminalPid } : {}),
    ...(rootPid !== undefined ? { root_pid: rootPid } : {}),
    ...(pids.length > 0 ? { pids } : {}),
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function uniquePositiveIntegers(values: Array<number | undefined>): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
