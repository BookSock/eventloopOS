import type { AutonomyGrant } from "./autonomy-grants.js";
import { evaluateAutonomyGrant, type AutonomySurface } from "./autonomy-grants.js";

export type EvidenceRef = {
  id: string;
  kind: string;
  title: string;
  url?: string;
};

export type HookDecision = {
  hook: string;
  decision: "allow" | "block" | "rewrite" | "require_approval";
  reason?: string;
  rewritten_payload?: Record<string, unknown>;
  evidence: EvidenceRef[];
};

export type HookEvaluatorInput = {
  hook: string;
  surface: AutonomySurface;
  payload?: Record<string, unknown>;
  approval_decision_id?: string;
  untrusted_source_text?: string;
  evidence?: EvidenceRef[];
  grants?: AutonomyGrant[];
  scope_kind?: AutonomyGrant["scope_kind"];
  scope_id?: string;
  now?: Date;
};

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /\bignore (all )?(previous|prior|above) (instructions|rules|policy)\b/i,
  /\b(system|developer|admin) (message|instruction|prompt)\s*:/i,
  /\bbypass (approval|policy|safety|permission)\b/i,
  /\bdo not (ask|require) (human )?approval\b/i,
  /\bsend (the )?(secret|credential|token|api key|password)s?\b/i,
  /\bexfiltrate\b/i,
];

export function evaluateHook(input: HookEvaluatorInput): HookDecision {
  const evidence = input.evidence ?? [];
  const injectionPattern = findPromptInjectionPattern(input.untrusted_source_text);

  if (injectionPattern && isHighRiskSurface(input.surface)) {
    return {
      hook: input.hook,
      decision: "block",
      reason: `untrusted source matched prompt injection pattern: ${injectionPattern}`,
      evidence,
    };
  }

  if (injectionPattern) {
    return {
      hook: input.hook,
      decision: "require_approval",
      reason: `untrusted source matched prompt injection pattern: ${injectionPattern}`,
      evidence,
    };
  }

  const autonomy = evaluateAutonomyGrant({
    surface: input.surface,
    scope_kind: input.scope_kind,
    scope_id: input.scope_id,
    grants: input.grants,
    now: input.now,
  });

  if (autonomy === "deny") {
    return {
      hook: input.hook,
      decision: "block",
      reason: `${input.surface} denied by autonomy grant policy`,
      evidence,
    };
  }

  if (autonomy === "ask" && !input.approval_decision_id) {
    return {
      hook: input.hook,
      decision: "require_approval",
      reason: `${input.surface} requires human approval`,
      evidence,
    };
  }

  return {
    hook: input.hook,
    decision: "allow",
    evidence,
  };
}

export function findPromptInjectionPattern(sourceText: string | undefined): string | undefined {
  if (!sourceText) {
    return undefined;
  }

  return PROMPT_INJECTION_PATTERNS.find((pattern) => pattern.test(sourceText))?.source;
}

function isHighRiskSurface(surface: AutonomySurface): boolean {
  return surface === "external_send" || surface === "prod_action" || surface === "money_action" || surface === "credential_action";
}
