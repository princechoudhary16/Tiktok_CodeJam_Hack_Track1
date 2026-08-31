export interface PolicyEvaluation {
  allowed: boolean;
  ruleId: string | null;
  reason: string;
}

interface PolicyRule {
  id: string;
  reason: string;
  pattern: RegExp;
}

const RULES: PolicyRule[] = [
  {
    id: "demo-explicit-deny",
    reason: "Controlled demo denial requested by the prompt marker.",
    pattern: /\[DENY-DEMO\]/i,
  },
  {
    id: "credential-exfiltration",
    reason: "The request appears to ask the Agent to reveal a protected credential.",
    pattern:
      /\b(?:print|show|dump|cat|read|reveal|exfiltrat\w*)\b[\s\S]{0,120}\b(?:ARK_API_KEY|APP_AUTH_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|OPENAI_API_KEY)\b/i,
  },
  {
    id: "sensitive-host-file",
    reason: "The request attempts to read a sensitive host credential file.",
    pattern: /(?:\/etc\/shadow|\.ssh\/(?:id_rsa|id_ed25519|authorized_keys))/i,
  },
  {
    id: "cloud-metadata-credential-endpoint",
    reason: "The request attempts to access a cloud instance metadata credential endpoint.",
    pattern: /169\.254\.169\.254/i,
  },
];

export function evaluatePromptPolicy(prompt: string): PolicyEvaluation {
  for (const rule of RULES) {
    if (rule.pattern.test(prompt)) {
      return {
        allowed: false,
        ruleId: rule.id,
        reason: rule.reason,
      };
    }
  }

  return {
    allowed: true,
    ruleId: null,
    reason: "No middleware deny rule matched.",
  };
}

export class MiddlewarePolicyDeniedError extends Error {
  constructor(
    public readonly ruleId: string,
    message: string,
  ) {
    super(message);
    this.name = "MiddlewarePolicyDeniedError";
  }
}